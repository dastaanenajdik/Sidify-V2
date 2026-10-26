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
 * Server-derived playback URLs are the one thing the browser still asks this
 * app for: a signed CDN manifest must be wrapped in a same-origin relay token,
 * and only the server can read the signing policy. `exclusiveCore` merges those
 * sources with the direct files the catalogue already returned.
 */

import {
  buildExclusiveHome,
  getExclusiveHome,
  getExclusiveTitle,
  searchExclusiveCatalogue,
  suggestExclusive,
  toPublicSearchPage,
  type CatalogueReader,
  type ExclusiveSearchOptions,
} from "./exclusiveCore";
import { readSnapshot, writeSnapshot } from "./exclusiveSnapshot";
import { exclusiveStatus } from "./exclusiveStatus";
import { dedupeTitles } from "./recommend";
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

/** Why the browser path was abandoned, for the diagnostics line. */
let directDisabledReason: string | null = null;

function disableDirect(reason: string): void {
  if (directDisabledReason) return;
  directDisabledReason = reason;
  exclusiveStatus.noteDirectFallback(reason);
  if (process.env.NODE_ENV !== "production") {
    console.info(`[exclusive] direct transport unavailable (${reason}); using the relay.`);
  }
}

function directUsable(): boolean {
  return DIRECT_ENABLED && !directDisabledReason && typeof window !== "undefined" && typeof fetch === "function";
}

/* -------------------------------- tickets -------------------------------- */

interface SignedCall {
  id: string;
  kind: "home" | "search" | "detail" | "resource" | "login";
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
    if (response.status === 401) forgetBrowserToken();
    throw new Error(`upstream ${response.status}`);
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
      if (cached && cached.expiresAt > Date.now()) {
        return { ...cached.value, playback: await playbackFor(slug, kind, cached.value) };
      }

      const token = await ensureBrowserToken();
      const calls = await fetchTicket(
        [
          { kind: "detail", subjectId },
          { kind: "resource", subjectId },
        ],
        token
      );
      const detailCall = calls.find((entry) => entry.kind === "detail");
      if (!detailCall) return null;

      const [detailPayload, resourcePayload] = await Promise.all([
        sendSigned(detailCall),
        (async () => {
          const resourceCall = calls.find((entry) => entry.kind === "resource");
          if (!resourceCall) return null;
          try {
            return await sendSigned(resourceCall);
          } catch (error) {
            if (error instanceof DirectBlocked) throw error;
            return null;
          }
        })(),
      ]);

      const parsed = detailsPayloadToDetail(detailPayload);
      if (!parsed) return null;

      const releases = resourceReleases(resourcePayload);
      const detail: MediaDetail = {
        title: { ...parsed.title, kind },
        seasons: parsed.seasons,
        related: [],
        playback: [],
        releases,
        provider: {
          id: "vault",
          label: "Vault",
          attribution: "Public catalogue metadata and stream links resolved for this session.",
          demo: false,
        },
      };

      detailCache.set(slug, { value: detail, expiresAt: Date.now() + DETAIL_TTL_MS });
      if (detailCache.size > 60) {
        const oldest = detailCache.keys().next().value;
        if (oldest) detailCache.delete(oldest);
      }

      return { ...detail, playback: await playbackFor(slug, kind, detail) };
    },
  };
}

function resourceReleases(payload: unknown): MediaDetail["releases"] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { list?: unknown }).list;
  if (!Array.isArray(list)) return [];

  const releases: NonNullable<MediaDetail["releases"]> = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const release = resourceItemToRelease(entry);
    if (!release) continue;
    const key = release.mirrors.map((mirror) => mirror.shortUrl.split("?")[0]).join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    releases.push(release);
  }
  return releases;
}

/**
 * The server-only half of playback: a signed CDN manifest has to be wrapped in
 * this app's relay token, which the browser cannot mint. Failure here is fine —
 * the direct MP4/HLS files the catalogue returned are still playable.
 */
async function playbackFor(slug: string, kind: MediaKind, detail: MediaDetail): Promise<PlaybackSource[]> {
  const direct = (detail.playback ?? []).filter((source) => !source.url.includes("/api/media/vault-stream/"));
  try {
    const response = await fetch("/api/media/exclusive/playback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ slug, type: kind }),
    });
    if (!response.ok) return direct;
    const payload = (await response.json()) as { sources?: PlaybackSource[] };
    if (!Array.isArray(payload.sources)) return direct;
    return [...payload.sources, ...direct];
  } catch {
    return direct;
  }
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

/** Title payload: direct → relay. */
export async function loadExclusiveTitle(
  slug: string,
  kind: MediaKind | undefined,
  relay: () => Promise<ExclusiveTitleResponse>
): Promise<ExclusiveTitleResponse> {
  if (directUsable()) {
    try {
      const payload = await getExclusiveTitle(directReader(), slug, kind);
      if (payload) {
        exclusiveStatus.noteSuccess("direct");
        return payload;
      }
      throw new Error("not_found");
    } catch (error) {
      if (error instanceof DirectBlocked) disableDirect(error.reason);
      exclusiveStatus.noteError((error as Error)?.message || "error");
    }
  }

  const payload = await relay();
  exclusiveStatus.noteSuccess("relay");
  return payload;
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
