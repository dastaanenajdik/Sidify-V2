"use client";

/**
 * The exclusive collection — **browser side**.
 *
 * This is the transport that fixes the actual bug: datacenter egress.
 *
 *   before   browser → Vercel function → upstream        (upstream sees AWS IPs)
 *   now      browser ─────────────────> upstream         (upstream sees the user)
 *
 * How a request gets signed without putting the key in the bundle:
 *
 *   1. the browser asks `/api/media/exclusive/ticket` for one batch of
 *      *signed* requests (the route builds the URL/path/body — the browser
 *      only names a kind of call);
 *   2. the browser sends those requests itself, with the headers the route
 *      produced;
 *   3. the payloads are parsed by the same adapters the server uses
 *      (`vaultAdapt.ts`) and composed by the same pure layer
 *      (`exclusiveCore.ts`), so rails/filters/recommendations are identical.
 *
 * If CORS refuses step 2 (the upstream does not send
 * `Access-Control-Allow-Origin`), the direct path is marked unavailable for the
 * session and every call falls back to the relay route — silently, because a
 * blocked optimisation is not a user-facing error.
 *
 * Details, the stream list and the download mirrors are all fetched this way:
 * **one ticket batch of three calls** (`detail` + `playback` + `resource`) when a
 * title page opens, parsed in the browser by the same adapters the server uses.
 * Nothing about resolution needs this app: the DASH relay token is plain
 * base64url JSON, so the browser builds it itself (`vaultPlayback.ts`). Only the
 * protected *bytes* take the relay, because a browser cannot send the CDN's
 * signed cookie — see `vaultStreamToken.ts`.
 */

import {
  buildExclusiveHome,
  getExclusiveHome,
  getExclusiveTitle,
  playableFromResources,
  searchExclusiveCatalogue,
  suggestExclusive,
  toPublicSearchPage,
  type CatalogueReader,
  type ExclusiveSearchOptions,
} from "./exclusiveCore";
import { readSnapshot, writeSnapshot } from "./exclusiveSnapshot";
import { exclusiveStatus } from "./exclusiveStatus";
import { dedupeTitles, recommendTitles } from "./recommend";
import { applyEpisodeReleases, dashPlaybackSources, isRelayedSource, mergePlaybackSources } from "./vaultPlayback";
import { mediaApi } from "./client";
import type {
  ExclusiveHome,
  ExclusiveSearchPage,
  ExclusiveSuggestions,
  ExclusiveTitleResponse,
  MediaDetail,
  MediaKind,
  MediaTitle,
  PlaybackSource,
} from "./types";
import {
  detailsPayloadToDetail,
  homepagePayloadToTitles,
  playInfoToReleases,
  resourceItemToRelease,
  searchPayloadToTitles,
  subjectIdFromSlug,
} from "./vaultAdapt";

/* ------------------------------- settings -------------------------------- */

export const DIRECT_ENABLED = process.env.NEXT_PUBLIC_EXCLUSIVE_DIRECT !== "0";
const DIRECT_TIMEOUT_MS = 12_000;
const TICKET_TIMEOUT_MS = 10_000;
/** How long a visitor token the browser obtained itself is reused. */
const BROWSER_TOKEN_TTL_MS = 10 * 60_000;
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_KEY = "home";
const SEARCH_SNAPSHOT_PREFIX = "search:";
const DETAIL_SNAPSHOT_PREFIX = "detail:";

/** Why the browser path was abandoned, for the diagnostics line. */
let directDisabledReason: string | null = null;

function disableDirect(reason: string): void {
  if (directDisabledReason) return;
  directDisabledReason = reason;
  exclusiveStatus.noteDirectFallback(reason);
  // One line, once per session: the fastest way to tell whether a deployment is
  // actually being served from the browser or falling back to the relay.
  console.info(`[exclusive] direct transport unavailable (${reason}); using the relay.`);
}

function directUsable(): boolean {
  return DIRECT_ENABLED && !directDisabledReason && typeof window !== "undefined" && typeof fetch === "function";
}

/* -------------------------------- tickets -------------------------------- */

interface SignedCall {
  id: string;
  kind: "home" | "search" | "detail" | "playback" | "resource" | "login";
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface TicketResponse {
  calls?: SignedCall[];
  expiresAt?: number;
}

/** Stable per-browser key, so the ticket route can reuse one ephemeral session. */
function ticketKey(): string {
  try {
    const existing = localStorage.getItem("sidify-exclusive-ticket-key");
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("sidify-exclusive-ticket-key", key);
    return key;
  } catch {
    return "anonymous";
  }
}

async function fetchTicket(
  calls: Array<{ kind: string; term?: string; subjectId?: string; se?: number; ep?: number }>,
  token?: string | null
): Promise<SignedCall[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TICKET_TIMEOUT_MS);
  try {
    const response = await fetch("/api/media/exclusive/ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(token ? { key: ticketKey(), calls, token } : { key: ticketKey(), calls }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ticket ${response.status}`);
    const payload = (await response.json()) as TicketResponse;
    if (!Array.isArray(payload.calls) || payload.calls.length === 0) throw new Error("ticket empty");
    return payload.calls;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------- login --------------------------------- */

let browserToken: { value: string; expiresAt: number } | null = null;

function tokenFromLoginPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const direct = record.token;
  if (typeof direct === "string" && direct.trim().length >= 8) return direct.trim();
  const nested = record.data;
  if (nested && typeof nested === "object") {
    const inner = (nested as Record<string, unknown>).token;
    if (typeof inner === "string" && inner.trim().length >= 8) return inner.trim();
  }
  return null;
}

/**
 * The visitor token for this browser.
 *
 * Deliberately obtained **here**, not from the server: signing a login needs
 * only the HMAC key, which the ticket route has, while *performing* the login
 * needs a connection to the catalogue — the thing this deployment may not have.
 * The route therefore signs `{ kind: "login" }`, the browser posts it, and the
 * token comes back over the user's own connection.
 *
 * Returns `null` when the login cannot be completed for a reason other than
 * CORS; the caller then asks for a ticket without a token and the route falls
 * back to minting one server-side.
 */
async function ensureBrowserToken(): Promise<string | null> {
  if (browserToken && browserToken.expiresAt > Date.now()) return browserToken.value;
  try {
    const calls = await fetchTicket([{ kind: "login" }]);
    const login = calls.find((call) => call.kind === "login");
    if (!login) return null;
    const payload = await sendSigned(login);
    const token = tokenFromLoginPayload(payload);
    if (!token) return null;
    browserToken = { value: token, expiresAt: Date.now() + BROWSER_TOKEN_TTL_MS };
    return token;
  } catch (error) {
    if (error instanceof DirectBlocked) throw error;
    return null;
  }
}

/** Drops the cached token, so the next call logs in again. */
function forgetBrowserToken(): void {
  browserToken = null;
}

/* ------------------------------ direct fetch ----------------------------- */

class DirectBlocked extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DirectBlocked";
  }
}

/**
 * The catalogue answered, but not with a payload.
 *
 * The status travels with the error because "the session is stale" (`401` or
 * the gateway's `440`) is actionable — a visitor token can be re-minted and the
 * call retried — while a `403` or a `5xx` is not.
 */
class UpstreamStatusError extends Error {
  constructor(readonly status: number) {
    super(`upstream ${status}`);
    this.name = "UpstreamStatusError";
  }
}

/** The gateway's own "session rejected" code (see the debug brief, §14). */
const SESSION_REJECTED = 440;

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : null;
}

/**
 * Sends one signed call from the browser.
 *
 * A `TypeError` here is the signature of a CORS refusal (the browser refuses to
 * expose *why*), so that is what flips the transport off for the session. Any
 * other failure is treated as a normal, per-call error and the caller falls
 * back for that request only.
 */
async function sendSigned(call: SignedCall): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(call.url, {
      method: call.method,
      headers: call.headers,
      body: call.body,
      // Never send this app's cookies to a third-party catalogue.
      credentials: "omit",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === "AbortError") throw new DirectBlocked("timeout");
    throw new DirectBlocked("cors_or_network");
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // A stale visitor token is the one rejection worth retrying here: drop it
    // so the next call logs in again. Everything else is a per-call failure the
    // caller handles by falling back to the relay.
    // A stale visitor session shows up as `401` or the gateway's `440`; drop it
    // so the retry path can log in again.
    if (response.status === 401 || response.status === SESSION_REJECTED) forgetBrowserToken();
    throw new UpstreamStatusError(response.status);
  }

  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    // The API wraps payloads in `{ data: … }`; the adapters also tolerate the
    // envelope, but unwrapping the same way the server does keeps both paths
    // byte-identical for the adapters.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const envelope = parsed as Record<string, unknown>;
      if ("data" in envelope) {
        const inner = envelope.data;
        if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
        if (inner === undefined || inner === null) return parsed;
        return inner;
      }
    }
    return parsed;
  } catch {
    throw new Error("malformed json");
  }
}

/* -------------------------------- reader --------------------------------- */

interface DirectCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const LISTING_TTL_MS = 5 * 60_000;
const SEARCH_TTL_MS = 5 * 60_000;
const DETAIL_TTL_MS = 10 * 60_000;

let listingCache: DirectCacheEntry<MediaTitle[]> | null = null;
let listingInFlight: Promise<MediaTitle[]> | null = null;
const searchCache = new Map<string, DirectCacheEntry<MediaTitle[]>>();
const detailCache = new Map<string, DirectCacheEntry<MediaDetail>>();

/**
 * Caches a title read — unless it came back without a playable source.
 *
 * A title whose stream list failed (a `440`, a CORS refusal) must not be pinned
 * for ten minutes: the empty state offers Retry, and Retry has to actually ask
 * the catalogue again.
 */
function cacheDetail(slug: string, detail: MediaDetail): void {
  if ((detail.playback ?? []).length === 0) return;
  detailCache.set(slug, { value: detail, expiresAt: Date.now() + DETAIL_TTL_MS });
  if (detailCache.size > 60) {
    const oldest = detailCache.keys().next().value;
    if (oldest) detailCache.delete(oldest);
  }
}

/** The reader the composition layer uses when the browser can reach the catalogue. */
export function directReader(): CatalogueReader {
  return {
    source: "direct",
    async listing(): Promise<MediaTitle[]> {
      const now = Date.now();
      if (listingCache && listingCache.expiresAt > now) return listingCache.value;
      if (listingInFlight) return listingInFlight;

      const load = (async () => {
        const token = await ensureBrowserToken();
        const calls = await fetchTicket([{ kind: "home" }], token);
        const payloads = await Promise.all(
          calls
            .filter((call) => call.kind === "home")
            // A dead tab is survivable (the others still answer), but a blocked
            // transport must surface: swallowing it here would turn "CORS said
            // no" into a misleading "no tab answered".
            .map((call) =>
              sendSigned(call).then(
                (payload) => payload,
                (error) => {
                  if (error instanceof DirectBlocked) throw error;
                  return null;
                }
              )
            )
        );

        const collected: MediaTitle[] = [];
        let answered = 0;
        for (const payload of payloads) {
          if (payload === null) continue;
          answered += 1;
          collected.push(...homepagePayloadToTitles(payload));
        }
        if (answered === 0) throw new Error("no tab answered");

        const titles = dedupeTitles(collected);
        listingCache = { value: titles, expiresAt: Date.now() + LISTING_TTL_MS };
        if (titles.length) writeSnapshot(SNAPSHOT_KEY, titles);
        return titles;
      })().finally(() => {
        listingInFlight = null;
      });

      listingInFlight = load;
      return load;
    },

    async search(term: string, limit: number): Promise<MediaTitle[]> {
      const key = term.toLowerCase();
      const cached = searchCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value.slice(0, limit);

      const token = await ensureBrowserToken();
      const calls = await fetchTicket([{ kind: "search", term }], token);
      const call = calls.find((entry) => entry.kind === "search");
      if (!call) return [];

      const payload = await sendSigned(call);
      const titles = searchPayloadToTitles(payload);
      searchCache.set(key, { value: titles, expiresAt: Date.now() + SEARCH_TTL_MS });
      if (searchCache.size > 100) {
        const oldest = searchCache.keys().next().value;
        if (oldest) searchCache.delete(oldest);
      }
      return titles.slice(0, limit);
    },

    async detail(slug: string, kind: MediaKind): Promise<MediaDetail | null> {
      const subjectId = subjectIdFromSlug(slug);
      if (!subjectId) return null;

      const cached = detailCache.get(slug);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const built = await fetchTitleDirect(subjectId, kind);
      if (!built) return null;

      cacheDetail(slug, built);
      return built;
    },
  };
}

/* ------------------------------ title reads ------------------------------ */

interface DirectTitleOptions {
  /** Season/episode for an episode's own stream list. */
  season?: number;
  episode?: number;
}

/**
 * Metadata + releases + playback sources, in **one signed batch**.
 *
 * Three calls (`detail`, `playback`, `resource`) fit inside the ticket's
 * four-call budget, so opening a title costs one round trip to this app (the
 * ticket) and three direct ones to the catalogue — executed from the viewer's
 * own connection.
 */
/** One signed call's outcome — a payload or the failure that stopped it. */
interface CallResult {
  payload: unknown | null;
  error: unknown;
}

const OK_RESULT: CallResult = { payload: null, error: null };

/** A short, log-safe description of one call, used by the console diagnostic. */
function describeCall(result: CallResult): string {
  if (!result.error) return result.payload === null ? "missing" : "ok";
  const status = statusOf(result.error);
  if (status !== null) return String(status);
  if (result.error instanceof DirectBlocked) return result.error.reason;
  return "error";
}

type TitleCallKind = "detail" | "playback" | "resource";

/**
 * Asks for tickets for `kinds` and sends them in parallel.
 *
 * A transport refusal (`DirectBlocked`) is re-thrown — it means every later
 * request would fail the same way — while a per-call failure is *returned*, so
 * one dead endpoint cannot take the other two down with it.
 */
async function runTitleCalls(
  subjectId: string,
  season: number,
  episode: number,
  token: string | null,
  kinds: readonly TitleCallKind[]
): Promise<{ calls: SignedCall[]; results: Map<TitleCallKind, CallResult> }> {
  const episodeHint = season > 0 && episode > 0 ? { se: season, ep: episode } : {};
  const calls = await fetchTicket(
    kinds.map((kind) => (kind === "detail" ? { kind, subjectId } : { kind, subjectId, ...episodeHint })),
    token
  );

  const results = new Map<TitleCallKind, CallResult>();
  await Promise.all(
    kinds.map(async (kind) => {
      const call = calls.find((entry) => entry.kind === kind);
      if (!call) {
        results.set(kind, { payload: null, error: new Error("missing call") });
        return;
      }
      try {
        results.set(kind, { payload: await sendSigned(call), error: null });
      } catch (error) {
        if (error instanceof DirectBlocked) throw error;
        results.set(kind, { payload: null, error });
      }
    })
  );
  return { calls, results };
}

/**
 * Notes why a title read never got as far as a payload.
 *
 * `DirectBlocked` means the browser itself could not make the call (CORS or a
 * dead network); a ticket failure means this app could not sign one. Both leave
 * the player area empty, so both get a sentence there.
 */
function noteTitleTransportFailure(error: unknown): void {
  if (error instanceof DirectBlocked) {
    exclusiveStatus.noteStreamIssue("cors_or_network");
    return;
  }
  const message = (error as Error)?.message ?? "";
  if (message.startsWith("ticket")) exclusiveStatus.noteStreamIssue("ticket_unavailable");
}

/** True when the catalogue rejected the session rather than the request. */
function isSessionRejection(result: CallResult): boolean {
  const status = statusOf(result.error);
  return status === 401 || status === SESSION_REJECTED;
}

/**
 * Metadata + releases + playback sources, in **one signed batch**.
 *
 * Three calls (`detail`, `playback`, `resource`) fit inside the ticket's
 * four-call budget, so opening a title costs one round trip to this app (the
 * ticket) and three direct ones to the catalogue — executed from the viewer's
 * own connection.
 *
 * Playback is the endpoint the catalogue guards hardest: it is the one that
 * used to answer `440` through the server. A `440`/`401` here therefore gets a
 * bounded retry (a fresh visitor token, then this app's own session), because a
 * stale session is the most likely reason a title resolves but its stream list
 * does not — and because the detail call already proved the network works.
 */
async function fetchTitleDirect(
  subjectId: string,
  kind: MediaKind,
  options: DirectTitleOptions = {}
): Promise<MediaDetail | null> {
  const season = options.season ?? 0;
  const episode = options.episode ?? 0;

  let token: string | null;
  let batch: Awaited<ReturnType<typeof runTitleCalls>>;
  try {
    // A failure *here* is about reaching the catalogue at all (no ticket, a
    // blocked transport) — worth naming in the UI, because it is also the
    // reason the player area stays empty.
    token = await ensureBrowserToken();
    batch = await runTitleCalls(subjectId, season, episode, token, ["detail", "playback", "resource"]);
  } catch (error) {
    noteTitleTransportFailure(error);
    throw error;
  }

  let pending = (["playback", "resource"] as const).filter((callKind) =>
    isSessionRejection(batch.results.get(callKind) ?? OK_RESULT)
  );
  if (pending.length && token !== null) {
    // Two strategies, in order, because both have been seen in production:
    //   1. the visitor token simply aged out → log in again;
    //   2. the browser's visitor session is not what this endpoint wants → let
    //      the ticket route mint this app's own ephemeral session instead (it
    //      answers 503 when its egress is blocked, which is survivable here).
    forgetBrowserToken();
    const attempts: Array<string | null> = [];
    const fresh = await ensureBrowserToken().catch(() => null);
    if (fresh) attempts.push(fresh);
    attempts.push(null);

    for (const attemptToken of attempts) {
      if (!pending.length) break;
      let retried: Awaited<ReturnType<typeof runTitleCalls>>;
      try {
        retried = await runTitleCalls(subjectId, season, episode, attemptToken, pending);
      } catch (error) {
        if (error instanceof DirectBlocked) throw error;
        continue; // this app cannot sign either — try the next strategy
      }
      const stillRejected: Array<(typeof pending)[number]> = [];
      for (const callKind of pending) {
        const result = retried.results.get(callKind);
        if (!result) {
          stillRejected.push(callKind);
          continue;
        }
        batch.results.set(callKind, result);
        if (isSessionRejection(result)) stillRejected.push(callKind);
      }
      pending = stillRejected;
    }
  }

  const detailCall = batch.calls.find((entry) => entry.kind === "detail") ?? null;
  const detailResult = batch.results.get("detail") ?? { payload: null, error: new Error("missing call") };
  const playbackResult = batch.results.get("playback") ?? OK_RESULT;
  const resourceResult = batch.results.get("resource") ?? OK_RESULT;

  // The detail call *is* the page: a failure there is the caller's to fall back on.
  if (detailResult.error) throw detailResult.error;

  const parsed = detailsPayloadToDetail(detailResult.payload);
  if (!parsed) return null;

  // The catalogue's own client identity, taken from the signed batch, so the
  // relayed CDN requests look exactly like the signed ones.
  const userAgent = (detailCall && headerValue(detailCall.headers, "user-agent")) || browserUserAgent();
  const streamReleases = playbackResult.payload
    ? playInfoToReleases(playbackResult.payload, season, episode, userAgent)
    : [];
  const fileReleases = resourceReleases(resourceResult.payload, season > 0 && episode > 0 ? { season, episode } : {});

  // Episode rows get their own files (free: the same flat listing), and what is
  // left stays at the title level as season packs.
  const titleLevel = applyEpisodeReleases(parsed.seasons, dedupeReleases([...streamReleases, ...fileReleases]));
  const detail: MediaDetail = {
    title: { ...parsed.title, kind },
    seasons: parsed.seasons,
    related: [],
    playback: [],
    releases: titleLevel,
    provider: providerInfoForCollection(),
  };

  // DASH first (built here, no server round trip), then every direct file the
  // catalogue already handed us.
  const dash = dashPlaybackSources(streamReleases, { origin: pageOrigin() });
  const files = playableFiles(detail);
  detail.playback = mergePlaybackSources(dash, files);

  noteStreamHealth(detail, { playback: playbackResult, resource: resourceResult });
  return detail;
}

/**
 * Records why a resolved title has (or has not) a playable source.
 *
 * This is the difference between a user staring at "no stream" and a user
 * (or a bug report) knowing that the catalogue said `440`, that the browser
 * never reached it, or that it simply lists nothing playable.
 */
function noteStreamHealth(
  detail: MediaDetail,
  results: { playback: CallResult; resource: CallResult }
): void {
  if ((detail.playback ?? []).length > 0) {
    exclusiveStatus.clearStreamIssue();
    return;
  }

  const failure = [results.playback, results.resource].find((result) => result.error) ?? null;
  let issue: Parameters<typeof exclusiveStatus.noteStreamIssue>[0] = "empty";
  let status: number | null = null;
  if (failure) {
    status = statusOf(failure.error);
    if (failure.error instanceof DirectBlocked) issue = "cors_or_network";
    else if (status === 401 || status === SESSION_REJECTED) issue = "session_rejected";
    else if (status === 403) issue = "refused";
    else issue = "upstream_error";
  }

  exclusiveStatus.noteStreamIssue(issue, status);
  // One line, so a screenshot of the console is enough for a bug report.
  console.info("[exclusive] no playable source", {
    playback: describeCall(results.playback),
    resource: describeCall(results.resource),
    issue,
    status,
  });
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : null;
}

function browserUserAgent(): string {
  if (typeof navigator !== "undefined" && navigator.userAgent) return navigator.userAgent;
  return "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36";
}

function pageOrigin(): string | null {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return null;
}

/**
 * Public entry point: the stream list for one title (or one episode), resolved
 * entirely in the browser. Used by the player when it needs sources only.
 */
export async function directPlaybackSources(
  slug: string,
  kind: MediaKind = "movie",
  options: DirectTitleOptions = {}
): Promise<PlaybackSource[]> {
  const subjectId = subjectIdFromSlug(slug);
  if (!subjectId) return [];

  if (!options.season && !options.episode) {
    // Reuse the cached title read when the page already loaded it.
    const cached = detailCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value.playback ?? [];
  }

  const built = await fetchTitleDirect(subjectId, kind, options);
  if (!built) return [];
  if (!options.season && !options.episode) cacheDetail(slug, built);
  return built.playback ?? [];
}

/** Public entry point: a title's detail payload, resolved in the browser. */
export async function directDetail(
  slug: string,
  kind: MediaKind = "movie",
  options: DirectTitleOptions = {}
): Promise<MediaDetail | null> {
  const subjectId = subjectIdFromSlug(slug);
  if (!subjectId) return null;

  if (!options.season && !options.episode) {
    const cached = detailCache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
  }

  const built = await fetchTitleDirect(subjectId, kind, options);
  if (built && !options.season && !options.episode) cacheDetail(slug, built);
  return built;
}

/**
 * The direct files a title already carries → playable sources.
 *
 * Kept separate from `exclusiveCore.playableFromResources` only so the browser
 * path can mark them clearly; the rules are the same (no MKV, no archives, no
 * relay URLs).
 */
function playableFiles(detail: MediaDetail): PlaybackSource[] {
  return playableFromResources(detail).filter((source) => !isRelayedSource(source.url));
}

function dedupeReleases(releases: MediaDetail["releases"]): NonNullable<MediaDetail["releases"]> {
  const seen = new Set<string>();
  const out: NonNullable<MediaDetail["releases"]> = [];
  for (const release of releases ?? []) {
    const key = release.mirrors.map((mirror) => mirror.shortUrl.split("?")[0]).join("|");
    const identity = key || release.id;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    out.push(release);
  }
  return out;
}

function resourceReleases(
  payload: unknown,
  episode: { season?: number; episode?: number } = {}
): NonNullable<MediaDetail["releases"]> {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { list?: unknown }).list;
  if (!Array.isArray(list)) return [];

  const releases: NonNullable<MediaDetail["releases"]> = [];
  for (const entry of list) {
    const release = resourceItemToRelease(entry);
    if (!release) continue;
    // A per-episode listing can still carry other episodes' files.
    if (episode.season && release.seasonNumber !== undefined && release.seasonNumber !== episode.season) continue;
    if (episode.episode && release.episodeNumber !== undefined && release.episodeNumber !== episode.episode) continue;
    releases.push(release);
  }
  return releases;
}

/* ------------------------- resilient public API -------------------------- */

/** The last snapshot of the listing, or `null` when there is none. */
export function cachedListing(): { at: number; titles: MediaTitle[] } | null {
  const snapshot = readSnapshot<MediaTitle[]>(SNAPSHOT_KEY, SNAPSHOT_MAX_AGE_MS);
  if (!snapshot?.value?.length) return null;
  return { at: snapshot.at, titles: snapshot.value };
}

/**
 * The landing payload assembled locally from the last snapshot — no network at
 * all. The timestamp is pinned to the snapshot's age so the UI can honestly say
 * "saved copy from …" instead of pretending it is live.
 */
function snapshotHome(kind: MediaKind | "all"): { home: ExclusiveHome; at: number } | null {
  const snapshot = readSnapshot<MediaTitle[]>(SNAPSHOT_KEY, SNAPSHOT_MAX_AGE_MS);
  if (!snapshot?.value?.length) return null;
  const pool = kind === "all" ? snapshot.value : snapshot.value.filter((title) => title.kind === kind);
  if (!pool.length) return null;
  return {
    home: buildExclusiveHome(pool, providerInfoForCollection(), new Date(snapshot.at)),
    at: snapshot.at,
  };
}

/**
 * Keeps the last good landing payload's titles as the offline copy.
 *
 * Only the titles are stored, not the assembled page: facets, rails and the
 * spotlight are rebuilt from them for free, and the stored payload stays small
 * enough for a 400 KB budget.
 */
function snapshotFromHome(home: ExclusiveHome): void {
  const pool: MediaTitle[] = [];
  if (home.spotlight) pool.push(home.spotlight);
  for (const rail of home.rails ?? []) pool.push(...rail.items);
  if (!pool.length) return;
  writeSnapshot(SNAPSHOT_KEY, dedupeTitles(pool));
}

function providerInfoForCollection(): ExclusiveTitleResponse["provider"] {
  return {
    id: "vault",
    label: "Vault",
    attribution: "Public catalogue metadata and stream links resolved for this session.",
    demo: false,
  };
}

/** Home payload: direct → live relay → last-known-good snapshot → throw. */
export async function loadExclusiveHome(
  kind: MediaKind | "all",
  relay: () => Promise<ExclusiveHome>
): Promise<ExclusiveHome> {
  if (directUsable()) {
    try {
      const home = await getExclusiveHome(directReader(), kind);
      exclusiveStatus.noteSuccess("direct");
      return home;
    } catch (error) {
      const reason = error instanceof DirectBlocked ? error.reason : (error as Error)?.message || "error";
      // A single failed call is not proof that the transport is broken, but a
      // CORS refusal is: `sendSigned` raises DirectBlocked only for that.
      if (error instanceof DirectBlocked) disableDirect(reason);
      exclusiveStatus.noteError(reason);
    }
  }

  try {
    const home = await relay();
    // Relay answers seed the same snapshot, so a visitor whose network never
    // allows the direct path still gets a saved copy the day the relay fails.
    snapshotFromHome(home);
    exclusiveStatus.noteSuccess("relay", null);
    return home;
  } catch (error) {
    const snapshot = snapshotHome(kind);
    if (snapshot) {
      exclusiveStatus.noteSuccess("snapshot", snapshot.at);
      return snapshot.home;
    }
    throw error;
  }
}

/**
 * Search page: direct → relay → (cached listing filtered locally).
 *
 * Returns the public page — the internal ranking pool never needs to reach the
 * component tree, so it is dropped here.
 */
export async function loadExclusiveSearch(
  options: ExclusiveSearchOptions,
  relay: () => Promise<ExclusiveSearchPage>
): Promise<ExclusiveSearchPage> {
  if (directUsable()) {
    try {
      const result = await searchExclusiveCatalogue(directReader(), options);
      exclusiveStatus.noteSuccess("direct");
      if (options.q) writeSnapshot(`${SEARCH_SNAPSHOT_PREFIX}${options.q}`, result.items);
      return toPublicSearchPage(result);
    } catch (error) {
      if (error instanceof DirectBlocked) disableDirect(error.reason);
      exclusiveStatus.noteError((error as Error)?.message || "error");
    }
  }

  try {
    const result = await relay();
    exclusiveStatus.noteSuccess("relay");
    return result;
  } catch (error) {
    // Last resort: filter the snapshot locally, so a search on a dead network
    // still finds titles the user has already seen.
    const snapshot = cachedListing();
    if (snapshot) {
      const local = await searchExclusiveCatalogue(snapshotReader(snapshot.titles), options);
      exclusiveStatus.noteSuccess("snapshot", snapshot.at);
      return toPublicSearchPage(local);
    }
    throw error;
  }
}

/**
 * Keeps a title's metadata for the next offline visit.
 *
 * Playback is deliberately *not* stored: a relayed DASH URL carries the CDN's
 * signed cookie, which expires, so replaying it later would only produce a
 * broken player. Metadata, seasons and download mirrors stay valid.
 */
function snapshotDetail(detail: MediaDetail): void {
  const slim: MediaDetail = {
    ...detail,
    related: [],
    playback: (detail.playback ?? []).filter((source) => !isRelayedSource(source.url)),
  };
  writeSnapshot(`${DETAIL_SNAPSHOT_PREFIX}${detail.title.slug}`, slim);
}

function cachedDetail(slug: string): { detail: MediaDetail; at: number } | null {
  const snapshot = readSnapshot<MediaDetail>(`${DETAIL_SNAPSHOT_PREFIX}${slug}`, SNAPSHOT_MAX_AGE_MS);
  if (!snapshot?.value?.title?.slug) return null;
  return { detail: snapshot.value, at: snapshot.at };
}

/** Wraps a resolved detail in the payload shape the app expects. */
function titleResponse(detail: MediaDetail): ExclusiveTitleResponse {
  const pool = cachedListing()?.titles ?? [];
  const recommendations = pool.length ? recommendTitles(detail.title, pool, 12) : [];
  return {
    detail: { ...detail, related: recommendations },
    recommendations,
    provider: providerInfoForCollection(),
  };
}

/**
 * Title payload: direct → relay → saved copy.
 *
 * The saved copy is the difference between "this film is not on the site" and
 * "the catalogue is having a moment": the page, its seasons, its downloads and
 * its recommendations all still render, labelled with their age.
 */
export async function loadExclusiveTitle(
  slug: string,
  kind: MediaKind | undefined,
  relay: () => Promise<ExclusiveTitleResponse>
): Promise<ExclusiveTitleResponse> {
  if (directUsable()) {
    try {
      const payload = await getExclusiveTitle(directReader(), slug, kind);
      if (payload) {
        snapshotDetail(payload.detail);
        exclusiveStatus.noteSuccess("direct");
        return payload;
      }
      throw new Error("not_found");
    } catch (error) {
      if (error instanceof DirectBlocked) disableDirect(error.reason);
      exclusiveStatus.noteError((error as Error)?.message || "error");
    }
  }

  let relayError: unknown = null;
  try {
    const payload = await relay();
    snapshotDetail(payload.detail);
    exclusiveStatus.noteSuccess("relay");
    return payload;
  } catch (error) {
    relayError = error;
  }

  const saved = cachedDetail(slug);
  if (saved) {
    exclusiveStatus.noteSuccess("snapshot", saved.at);
    return titleResponse(saved.detail);
  }
  throw relayError instanceof Error ? relayError : new Error("The title could not be loaded.");
}

/** Typeahead: best-effort, never throws. */
export async function loadExclusiveSuggestions(q: string, limit: number): Promise<ExclusiveSuggestions> {
  if (directUsable()) {
    try {
      const result = await suggestExclusive(directReader(), q, limit);
      exclusiveStatus.noteSuccess("direct");
      return result;
    } catch (error) {
      if (error instanceof DirectBlocked) disableDirect(error.reason);
    }
  }
  try {
    return await mediaApi.exclusiveSuggest(q, limit);
  } catch {
    return { query: q.trim(), items: [], tookMs: 0 };
  }
}

/** A reader over an in-memory pool — the offline fallback for search. */
function snapshotReader(titles: MediaTitle[]): CatalogueReader {
  return {
    source: "direct",
    async listing() {
      return titles;
    },
    async search(term: string) {
      const needle = term.toLowerCase();
      return titles.filter((title) => title.title.toLowerCase().includes(needle));
    },
    async detail() {
      return null;
    },
  };
}

/** Whether the browser path is currently believed to work (diagnostics only). */
export function directStatus(): { enabled: boolean; reason: string | null } {
  return { enabled: directUsable(), reason: directDisabledReason };
}
