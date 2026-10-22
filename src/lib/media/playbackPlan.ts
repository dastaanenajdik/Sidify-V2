/**
 * "Try Play (beta)" planning: which release to try first, which resolved links are worth
 * handing to `<video>`, and the bounded quality-fallback loop.
 *
 * Policy (kept framework-free so the Node test runner covers it):
 *   - Highest quality first (2160p → 1080p → 720p → 480p); equal tiers keep page order.
 *   - MKV / extension-less direct files are *attempted*, never marked verified-playable.
 *     Success is decided by real playback events in the browser, not by file names.
 *   - A link only counts as playing when its picture AND its sound work. Where the engine
 *     exposes live decoder counters (Chromium), a file whose video decodes but whose audio
 *     doesn't (e.g. Dolby DD/DDP in Chrome) is a `no-audio` failure and the next quality is
 *     tried. Elsewhere, releases whose file name suggests only browser-unsupported audio
 *     are tried after the others (order only — never a verdict).
 *   - A file-level failure (decode error, no picture after metadata, no sound) skips the
 *     other servers/mirrors of the same release — they serve the same encode.
 *   - Network-type failures try the next server/mirror; at most ONE fresh re-resolve per
 *     session. A `blocked` (CAPTCHA / 401–403) mirror is skipped, never retried or bypassed.
 *   - Attempts and wall-clock time per session are capped.
 *
 * Media bytes never touch our servers: the browser loads the resolved CDN URL directly.
 */

import type { MediaMirror, MediaReleaseItem, MirrorResolveResult, ResolvedMirrorLink } from "./types";

/* ------------------------------ ordering -------------------------------- */

const QUALITY_RANK: Record<string, number> = {
  "2160p": 7,
  "1440p": 6,
  "1080p": 5,
  "720p": 4,
  "576p": 3,
  "480p": 2,
  "360p": 1,
};

/** Higher is better; unknown qualities rank last. */
export function qualityRank(quality?: string | null): number {
  if (!quality) return 0;
  return QUALITY_RANK[quality.trim().toLowerCase()] ?? 0;
}

/** Best quality first; equal tiers keep their original (page) order. */
export function sortByQuality<T extends { quality?: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => qualityRank(b.item.quality) - qualityRank(a.item.quality) || a.index - b.index)
    .map(({ item }) => item);
}

const ARCHIVE_CONTAINERS = new Set(["ZIP", "RAR", "7Z"]);

/** Season packs / archives are download-only. */
export function isArchiveRelease(release: Pick<MediaReleaseItem, "isPack" | "container">): boolean {
  return Boolean(release.isPack) || ARCHIVE_CONTAINERS.has(String(release.container || "").toUpperCase());
}

/** Releases "Try Play (beta)" may attempt: single files with mirrors, best quality first. */
export function playableReleases(releases: readonly MediaReleaseItem[]): MediaReleaseItem[] {
  return sortByQuality(releases.filter((release) => !isArchiveRelease(release) && release.mirrors.length > 0));
}

/** Every release with mirrors, best quality first (what the download picker lists). */
export function downloadableReleases(releases: readonly MediaReleaseItem[]): MediaReleaseItem[] {
  return sortByQuality(releases.filter((release) => release.mirrors.length > 0));
}

/**
 * Releases a player app (VLC, MX Player, Infuse) can be pointed at: every single file with
 * mirrors, best quality first. Unlike the browser these apps decode MKV, HEVC and Dolby, so
 * nothing is filtered by container — only packs/archives are, since a `.zip` cannot stream.
 */
export function externalPlayerReleases(releases: readonly MediaReleaseItem[]): MediaReleaseItem[] {
  return downloadableReleases(releases).filter((release) => !isArchiveRelease(release));
}

/* ------------------------------ labels ---------------------------------- */

function shortBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(gb >= 10 ? 1 : 2).replace(/\.?0+$/, "")} GB`;
  const mb = bytes / 1024 ** 2;
  return `${Math.max(1, Math.round(mb))} MB`;
}

/** `"1.19 GB – 6.94 GB"`, a single size, or `""` when no sizes are known. */
export function sizeRangeLabel(releases: readonly Pick<MediaReleaseItem, "sizeBytes" | "size">[]): string {
  const sizes = releases.map((r) => r.sizeBytes).filter((n): n is number => typeof n === "number" && n > 0);
  if (!sizes.length) return releases.find((r) => r.size)?.size ?? "";
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  return min === max ? shortBytes(min) : `${shortBytes(min)} – ${shortBytes(max)}`;
}

/** Distinct quality tiers, best first: `["2160p", "1080p", "720p"]`. */
export function qualityTiers(releases: readonly Pick<MediaReleaseItem, "quality">[]): string[] {
  const seen = new Set<string>();
  for (const release of sortByQuality(releases)) {
    const tier = release.quality || "Other";
    seen.add(tier);
  }
  return [...seen];
}

/* ------------------------- resolved link → candidate --------------------- */

export interface StreamCandidate {
  /** URL handed to the media element (inline form for hosts that support it). */
  url: string;
  /** URL exactly as resolved — what Download / Copy URL / external players use. */
  sourceUrl: string;
  server: string;
  kind: "hls" | "file";
  /** Resolver verified an MP4 / WebM / HLS container. MKV & unknown files are `false`. */
  verified: boolean;
  container?: string;
}

/**
 * PixelDrain's `?download` flag only switches `Content-Disposition` to attachment; the
 * inline form of the same public API URL is what a media element should request.
 */
export function inlineStreamUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/(^|\.)pixeldrain\.(?:com|dev)$/i.test(parsed.hostname) && parsed.pathname.startsWith("/api/file/")) {
      parsed.searchParams.delete("download");
      return parsed.toString();
    }
  } catch {
    /* keep original */
  }
  return url;
}

function isRateLimitedHost(url: string): boolean {
  // Free PixelDrain downloads are rate-limited / hotlink-protected — try other servers first.
  return /(^|\/\/|\.)pixeldrain\.(?:com|dev)\//i.test(url);
}

/**
 * Links worth attempting in the browser: direct files and HLS, never landing pages or
 * archives. Verified MP4/WebM/HLS first, rate-limited hosts last, otherwise page order.
 */
export function streamCandidates(links: readonly ResolvedMirrorLink[]): StreamCandidate[] {
  const seen = new Set<string>();
  const ranked: (StreamCandidate & { order: number })[] = [];

  links.forEach((link, order) => {
    if (!link || link.delivery === "external") return;
    if (ARCHIVE_CONTAINERS.has(String(link.container || "").toUpperCase())) return;
    if (typeof link.url !== "string" || !/^https:\/\//i.test(link.url)) return;
    const url = inlineStreamUrl(link.url);
    if (seen.has(url)) return;
    seen.add(url);
    ranked.push({
      url,
      sourceUrl: link.url,
      server: link.server || "Server",
      kind: link.streamType === "hls" ? "hls" : "file",
      verified: Boolean(link.playable),
      container: link.container,
      order,
    });
  });

  return ranked
    .sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        Number(isRateLimitedHost(a.url)) - Number(isRateLimitedHost(b.url)) ||
        a.order - b.order
    )
    .map(({ order: _order, ...candidate }) => candidate);
}

/** Direct download links (no landing pages), in resolver order. */
export function downloadLinks(links: readonly ResolvedMirrorLink[]): ResolvedMirrorLink[] {
  return links.filter((link) => link && link.delivery !== "external" && /^https:\/\//i.test(link.url));
}

/**
 * Links worth handing to an external player app (VLC, MX Player, Infuse, IINA): every
 * direct HTTPS media stream or file — including MKV / HEVC / Dolby that HTML5 `<video>`
 * cannot decode — while strictly excluding host landing pages (`delivery === "external"`),
 * season archive packs (`ZIP`/`RAR`/`7Z`), non-HTTPS schemes and embedded credentials.
 *
 * Ordering puts verified browser streams (HLS / MP4 / WebM) first, then true byte-range
 * direct CDN servers (`FSL Server`, R2, direct media file paths), then other servers, and
 * rate-limited hosts (PixelDrain) last — keeping every valid server option so the user can
 * tap whichever link works best on their network.
 */
export interface ExternalPlayerLink {
  url: string;
  server: string;
  container?: string;
  streamType?: ResolvedMirrorLink["streamType"];
}

function isDirectCdnServer(url: string, server?: string): boolean {
  if (/\bfsl\b/i.test(server || "")) return true;
  if (/r2\.cloudflarestorage\.com|r2\.dev/i.test(url)) return true;
  try {
    const pathname = new URL(url).pathname;
    if (/\.(?:mkv|mp4|webm|m3u8|avi|ts|m4v|mov)$/i.test(pathname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function isSafeHttpsMediaUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function externalPlayerLinks(links: readonly ResolvedMirrorLink[]): ExternalPlayerLink[] {
  const seen = new Set<string>();
  const ranked: (ExternalPlayerLink & {
    verified: boolean;
    directCdn: boolean;
    rateLimited: boolean;
    order: number;
  })[] = [];

  links.forEach((link, order) => {
    if (!link || link.delivery === "external") return;
    if (ARCHIVE_CONTAINERS.has(String(link.container || "").toUpperCase())) return;
    if (!isSafeHttpsMediaUrl(link.url)) return;
    if (seen.has(link.url)) return;
    seen.add(link.url);
    ranked.push({
      url: link.url,
      server: link.server || "Server",
      container: link.container,
      streamType: link.streamType === "hls" ? "hls" : link.streamType,
      verified: Boolean(link.playable),
      directCdn: isDirectCdnServer(link.url, link.server),
      rateLimited: isRateLimitedHost(link.url),
      order,
    });
  });

  return ranked
    .sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        Number(b.directCdn) - Number(a.directCdn) ||
        Number(a.rateLimited) - Number(b.rateLimited) ||
        a.order - b.order
    )
    .map(({ verified: _v, directCdn: _d, rateLimited: _r, order: _o, ...item }) => item);
}

export function externalPlayerLink(links: readonly ResolvedMirrorLink[]): ExternalPlayerLink | undefined {
  return externalPlayerLinks(links)[0];
}

/**
 * The validated host page (HubCloud / HubDrive) that a `partial` resolution returns when it
 * found no direct server links. Opening it is a working manual download path — the old
 * release cards showed it as a plain "Open" link, so it isn't presented as an error.
 */
export function landingPageUrl(result: Pick<MirrorResolveResult, "links"> | null | undefined): string | undefined {
  return result?.links?.find((link) => link?.delivery === "external" && /^https:\/\//i.test(link.url))?.url;
}

/* --------------------------- attempt outcomes ---------------------------- */

export type AttemptFailure = "network" | "decode" | "no-picture" | "timeout" | "no-audio";

export type AttemptOutcome = { ok: true } | { ok: false; failure: AttemptFailure | "aborted" };

/** The same encode on another server will not decode (or sound) any better. */
export function isFileLevelFailure(failure: AttemptFailure | "aborted"): boolean {
  return failure === "decode" || failure === "no-picture" || failure === "no-audio";
}

/** Seconds of real playback before a file with zero decoded audio counts as silent. */
export const AUDIO_CHECK_SECONDS = 2;

export interface AudioSample {
  /** Seconds of media played since the check started. */
  progress: number;
  /** `webkitAudioDecodedByteCount` — compressed audio bytes the decoder consumed. */
  audioBytes: number | undefined;
  /** `webkitVideoDecodedByteCount` — proves the counters are live in this engine. */
  videoBytes: number | undefined;
  /** `getVideoPlaybackQuality().totalVideoFrames`, a progress signal that survives stalls. */
  frames?: number;
}

export type AudioVerdict = "audio" | "silent" | "pending" | "unknown";

/**
 * Is the sound actually decoding? Chromium counts the compressed bytes each decoder
 * consumes. A track the browser can't decode (AC-3 / E-AC-3 / DTS in Chrome) never reaches
 * a decoder, so its counter stays at 0 while the video counter climbs. The counter does
 * not depend on volume or mute, so muted autoplay is checked the same way.
 *   - `audio`:   audio bytes are being decoded.
 *   - `silent`:  video decoded for AUDIO_CHECK_SECONDS (or ~2 s of frames) with no audio.
 *   - `unknown`: counters aren't live here (video counter stuck at 0) — can't tell.
 *   - `pending`: keep watching.
 */
export function audioVerdict(sample: AudioSample, minProgress = AUDIO_CHECK_SECONDS): AudioVerdict {
  const audio = Number(sample.audioBytes) || 0;
  const video = Number(sample.videoBytes) || 0;
  if (audio > 0) return "audio";
  const progressed = sample.progress >= minProgress || (sample.frames ?? 0) >= minProgress * 30;
  if (!progressed) return "pending";
  return video > 0 ? "silent" : "unknown";
}

/**
 * Engine messages that mean "the file arrived and is real media, but none of its tracks
 * can be decoded here" (e.g. Chromium: HEVC + E-AC-3 MKV without HEVC hardware support).
 * HTTP failures (403/404, DNS, expired tokens) surface as a generic "Format error" instead.
 */
const UNSUPPORTED_TRACKS_RE =
  /NO_SUPPORTED_STREAMS|DECODER_ERROR_NOT_SUPPORTED|PIPELINE_ERROR_DECODE|no supported streams|unsupported (?:video|audio )?codec/i;

/**
 * Classify a media element error. `MEDIA_ERR_DECODE` (3), any error after metadata loaded,
 * or an engine message saying no track is decodable means the file itself won't play here
 * (another server would serve the same encode). Anything else before metadata — network
 * errors, 403/404 bodies, expired tokens, non-media responses — is a server-level problem.
 */
export function classifyMediaError(
  code: number | null | undefined,
  metadataLoaded: boolean,
  message?: string | null
): AttemptFailure {
  if (code === 3 || metadataLoaded) return "decode";
  if (message && UNSUPPORTED_TRACKS_RE.test(message)) return "decode";
  return "network";
}

/**
 * Classify a fatal HLS failure (see `HlsFatalInfo.kind` in hlsPlayer.ts). Segments that
 * arrived but won't decode — or a browser with no HLS support at all — fail the same way
 * on every server, so they are file-level. Only transport failures try the next server.
 */
export function classifyHlsFatal(kind: string | undefined): AttemptFailure {
  return kind === "media" || kind === "unsupported" ? "decode" : "network";
}

/* ------------------------------ the loop -------------------------------- */

export const MAX_ATTEMPTS_PER_SESSION = 12;
export const SESSION_BUDGET_MS = 180_000;

/** One user action ("Try Play", pick a quality, "Try again"). Automatic recovery reuses it. */
export class PlaybackSession {
  readonly triedUrls = new Set<string>();
  readonly blockedMirrors = new Set<string>();
  attempts = 0;
  reResolveUsed = false;
  lastCandidate: StreamCandidate | null = null;

  constructor(
    readonly startedAt: number = Date.now(),
    readonly maxAttempts: number = MAX_ATTEMPTS_PER_SESSION,
    readonly budgetMs: number = SESSION_BUDGET_MS
  ) {}
}

export type PlaybackPhase = "resolving" | "trying" | "refreshing" | "playing" | "failed";

export interface PlaybackStatus {
  phase: PlaybackPhase;
  releaseIndex?: number;
  release?: MediaReleaseItem;
  mirror?: MediaMirror;
  candidate?: StreamCandidate;
  attempt?: number;
}

/** The best link that showed a picture but had no sound (offered as "Play without sound"). */
export interface SilentCandidate {
  releaseIndex: number;
  release: MediaReleaseItem;
  candidate: StreamCandidate;
}

export type FallbackResult =
  | { status: "playing"; releaseIndex: number; release: MediaReleaseItem; candidate: StreamCandidate }
  | { status: "failed"; reason: "exhausted" | "no-sources" | "limit"; silent?: SilentCandidate }
  | { status: "aborted" };

export interface FallbackOptions {
  resolve: (mirror: MediaMirror, release: MediaReleaseItem, options: { refresh: boolean }) => Promise<MirrorResolveResult>;
  attempt: (candidate: StreamCandidate, release: MediaReleaseItem) => Promise<AttemptOutcome>;
  onStatus?: (status: PlaybackStatus) => void;
  signal?: AbortSignal;
  /** Index into `releases` to start from (manual quality pick / "next quality"). */
  startIndex?: number;
  /**
   * Releases to try only after the others (e.g. file name suggests audio this browser
   * can't decode). Changes the order, never skips anything.
   */
  isDeferred?: (release: MediaReleaseItem) => boolean;
  /** The user picked `startIndex` themselves: try it first even if it is deferred. */
  pinStart?: boolean;
  now?: () => number;
}

/**
 * Order in which releases are tried: from `startIndex` down, best quality first, with
 * deferred releases moved after the rest (each group keeps its order). A pinned start
 * stays first.
 */
export function attemptOrder(
  releases: readonly MediaReleaseItem[],
  options: { startIndex?: number; isDeferred?: (release: MediaReleaseItem) => boolean; pinStart?: boolean } = {}
): number[] {
  const start = Math.max(0, options.startIndex ?? 0);
  const indices: number[] = [];
  for (let i = start; i < releases.length; i++) indices.push(i);
  const deferred = options.isDeferred;
  if (!deferred) return indices;
  const head = options.pinStart && indices.length ? [indices.shift()!] : [];
  const now = indices.filter((i) => !deferred(releases[i]));
  const later = indices.filter((i) => deferred(releases[i]));
  return [...head, ...now, ...later];
}

type Verdict =
  | { kind: "played"; candidate: StreamCandidate }
  | { kind: "file-failed" | "network-failed" | "aborted" | "limit" };

/**
 * Walk `releases` (already sorted best first) until something plays. Returns which
 * release/link is playing, or why it stopped. Never throws for upstream failures.
 */
export async function runPlaybackFallback(
  session: PlaybackSession,
  releases: readonly MediaReleaseItem[],
  options: FallbackOptions
): Promise<FallbackResult> {
  const { resolve, attempt, onStatus, signal } = options;
  const now = options.now ?? Date.now;
  const isAborted = () => Boolean(signal?.aborted);
  const overLimit = () => session.attempts >= session.maxAttempts || now() - session.startedAt > session.budgetMs;
  let sawCandidate = false;
  let silent: SilentCandidate | undefined;

  const failed = (reason: "exhausted" | "no-sources" | "limit"): FallbackResult => {
    onStatus?.({ phase: "failed" });
    return silent ? { status: "failed", reason, silent } : { status: "failed", reason };
  };

  const playing = (releaseIndex: number, release: MediaReleaseItem, candidate: StreamCandidate): FallbackResult => {
    onStatus?.({ phase: "playing", releaseIndex, release, candidate, attempt: session.attempts });
    return { status: "playing", releaseIndex, release, candidate };
  };

  const tryCandidates = async (
    candidates: StreamCandidate[],
    release: MediaReleaseItem,
    releaseIndex: number
  ): Promise<Verdict> => {
    for (const candidate of candidates) {
      if (isAborted()) return { kind: "aborted" };
      if (overLimit()) return { kind: "limit" };
      session.attempts += 1;
      session.triedUrls.add(candidate.url);
      session.lastCandidate = candidate;
      sawCandidate = true;
      onStatus?.({ phase: "trying", releaseIndex, release, candidate, attempt: session.attempts });

      let outcome: AttemptOutcome;
      try {
        outcome = await attempt(candidate, release);
      } catch {
        outcome = { ok: false, failure: "network" };
      }
      if (isAborted() || (!outcome.ok && outcome.failure === "aborted")) return { kind: "aborted" };
      if (outcome.ok) return { kind: "played", candidate };
      // Keep the best (highest-quality) silent link, whatever order releases were tried in.
      if (outcome.failure === "no-audio" && (!silent || releaseIndex < silent.releaseIndex)) silent = { releaseIndex, release, candidate };
      if (isFileLevelFailure(outcome.failure)) return { kind: "file-failed" };
    }
    return { kind: "network-failed" };
  };

  const safeResolve = async (mirror: MediaMirror, release: MediaReleaseItem, refresh: boolean) => {
    try {
      return await resolve(mirror, release, { refresh });
    } catch {
      return null;
    }
  };

  const order = attemptOrder(releases, { startIndex: options.startIndex, isDeferred: options.isDeferred, pinStart: options.pinStart });
  for (const releaseIndex of order) {
    const release = releases[releaseIndex];

    for (const mirror of release.mirrors) {
      if (isAborted()) return { status: "aborted" };
      if (overLimit()) return failed("limit");
      if (session.blockedMirrors.has(mirror.shortUrl)) continue;

      onStatus?.({ phase: "resolving", releaseIndex, release, mirror });
      const result = await safeResolve(mirror, release, false);
      if (isAborted()) return { status: "aborted" };
      if (!result) continue;
      if (result.status === "blocked") {
        // CAPTCHA / access control: skip this mirror — no retry, no bypass.
        session.blockedMirrors.add(mirror.shortUrl);
        continue;
      }

      const all = streamCandidates(result.links);
      if (!all.length) continue;
      const fresh = all.filter((candidate) => !session.triedUrls.has(candidate.url));

      let verdict: Verdict = fresh.length ? await tryCandidates(fresh, release, releaseIndex) : { kind: "network-failed" };
      if (verdict.kind === "played") return playing(releaseIndex, release, verdict.candidate);
      if (verdict.kind === "aborted") return { status: "aborted" };
      if (verdict.kind === "limit") return failed("limit");
      if (verdict.kind === "file-failed") break; // same encode everywhere → next quality

      // Every link of this mirror failed at the network level (or was already tried,
      // e.g. it expired mid-playback). One fresh re-resolve per session, then move on.
      if (!session.reResolveUsed) {
        session.reResolveUsed = true;
        onStatus?.({ phase: "refreshing", releaseIndex, release, mirror });
        const refreshed = await safeResolve(mirror, release, true);
        if (isAborted()) return { status: "aborted" };
        if (refreshed?.status === "blocked") {
          session.blockedMirrors.add(mirror.shortUrl);
          continue;
        }
        const retry = refreshed ? streamCandidates(refreshed.links).filter((c) => !session.triedUrls.has(c.url)) : [];
        if (retry.length) {
          verdict = await tryCandidates(retry, release, releaseIndex);
          if (verdict.kind === "played") return playing(releaseIndex, release, verdict.candidate);
          if (verdict.kind === "aborted") return { status: "aborted" };
          if (verdict.kind === "limit") return failed("limit");
          if (verdict.kind === "file-failed") break;
        }
      }
    }
  }

  return failed(sawCandidate ? "exhausted" : "no-sources");
}
