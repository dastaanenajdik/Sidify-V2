/**
 * Sidify — server-side YouTube engine, powered by `youtubei.js` (InnerTube).
 *
 * This replaces the previous `yt-dlp` child-process implementation, which needed a
 * binary on disk (file-permission problems) and got blocked outright from datacenter
 * IPs. Everything here is pure JS over InnerTube HTTP endpoints.
 *
 * Why the custom evaluator matters: the Node platform shim ships an `eval` that
 * simply *throws* ("you must provide your own JavaScript evaluator"), so without it
 * every `signatureCipher` / `n`-parameter URL fails to decipher and streaming 403s.
 * We install a `node:vm` based evaluator once, before the session is created.
 *
 * NOTE: `node:vm` is a *stability* boundary (timeouts), not a security sandbox. The
 * evaluated script is YouTube's own player code, fetched over TLS by youtubei.js.
 * These routes run on the Node runtime only — never on Edge.
 */
import vm from "node:vm";
import type { Album, Artist, Track } from "./types";
import {
  backfillFromTracks,
  classifyItems,
  decodePseudoAlbum,
  flattenShelves,
  isPseudoAlbumId,
  isVideoId,
  toAlbum,
  toTrack,
  upscaleGstatic,
  ytThumbs,
} from "./parser";

/**
 * `youtubei.js` is imported **lazily**, never statically.
 *
 * A top-level `import { Innertube } from "youtubei.js"` pulls the package (and its
 * ESM-only graph: `@bufbuild/protobuf`, `meriyah`, `fflate`) into the route module
 * graph, so `next build` evaluates it during "Collecting page data" and Vercel's
 * output tracing has to resolve its conditional `exports` map at build time — which
 * is exactly what failed the deployment. Deferring to `await import()` keeps the
 * package out of build-time evaluation entirely (the same pattern the previous
 * engine used) with no behavioural cost: the singleton is built on first request
 * either way, and Node caches the dynamic import afterwards.
 */
type YTModule = typeof import("youtubei.js");
type YT = InstanceType<YTModule["Innertube"]>;

let ytModulePromise: Promise<YTModule> | null = null;
function loadYTModule(): Promise<YTModule> {
  if (!ytModulePromise) ytModulePromise = import("youtubei.js");
  return ytModulePromise;
}

const VM_TIMEOUT_MS = 10_000;
/** Hard cap on session bootstrap so a hung YouTube fetch can't eat the whole request. */
const SESSION_TIMEOUT_MS = 20_000;

/** Survives Next.js dev-mode HMR, which otherwise rebuilds a session per request. */
const g = globalThis as typeof globalThis & {
  __sidifyVmPatched?: boolean;
  __sidifyYt?: YT | null;
  __sidifyYtPromise?: Promise<YT> | null;
  /** True when we booted without the JS player (search works, native streaming does not). */
  __sidifyDegraded?: boolean;
};

/* ------------------------------ vm evaluator ------------------------------ */

/**
 * youtubei.js hands us `{ output, exported }` plus an env of `{ n?, sp?, sig? }` and
 * expects the completion value of the script back — an object like `{ sig, n }`.
 * `vm.runInNewContext` returns exactly that completion value.
 */
async function installVmEvaluator(): Promise<void> {
  if (g.__sidifyVmPatched) return;
  const { Platform } = await loadYTModule();
  Platform.load({
    ...Platform.shim,
    eval: (data: { output: string }, env: Record<string, any>) =>
      vm.runInNewContext(data.output, env, { timeout: VM_TIMEOUT_MS }),
  });
  g.__sidifyVmPatched = true;
}

/* ------------------------------ singleton ------------------------------ */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Boots the InnerTube session.
 *
 * `retrieve_player: true` downloads and parses YouTube's `base.js`, and youtubei.js
 * hard-throws if that fetch fails. But search / metadata / artwork need *no* player at
 * all — only signature deciphering does. So if the full boot fails we retry without
 * the player: the catalogue keeps working and playback degrades to the YouTube IFrame
 * engine instead of the whole app returning 502s.
 */
async function createSession(): Promise<YT> {
  const { Innertube } = await loadYTModule();
  const base = {
    // youtubei.js types `cache` as `ICache`, but every code path guards with
    // `if (cache)` — any falsy value genuinely disables disk caching, which is
    // what we want on ephemeral serverless/container filesystems.
    cache: false as unknown as undefined,
    generate_session_locally: false,
    // If YouTube is unreachable at boot, fall back to locally generated session
    // data instead of hard-failing the whole app.
    fail_fast: false,
    enable_session_cache: false,
  };

  try {
    const yt = await withTimeout(
      Innertube.create({ ...base, retrieve_player: true }),
      SESSION_TIMEOUT_MS,
      "InnerTube session (with player)"
    );
    g.__sidifyDegraded = false;
    return yt;
  } catch (err) {
    console.warn(
      "[sidify] full InnerTube session failed, retrying without the JS player:",
      (err as Error)?.message
    );
    const yt = await withTimeout(
      Innertube.create({ ...base, retrieve_player: false }),
      SESSION_TIMEOUT_MS,
      "InnerTube session (no player)"
    );
    g.__sidifyDegraded = true;
    return yt;
  }
}

/**
 * Persistent InnerTube client. One session (visitor data + deciphered JS player) is
 * reused for the lifetime of the process; concurrent callers share one in-flight
 * creation promise so a cold start never fires duplicate player downloads.
 */
export async function getYT(): Promise<YT> {
  if (g.__sidifyYt) return g.__sidifyYt;
  if (g.__sidifyYtPromise) return g.__sidifyYtPromise;

  // The evaluator must be installed before the session is created, and the lock has
  // to be claimed synchronously so concurrent cold-start callers don't double-boot.
  const pending = (async () => {
    await installVmEvaluator();
    const yt = await createSession();
    g.__sidifyYt = yt;
    return yt;
  })();

  g.__sidifyYtPromise = pending;
  try {
    return await pending;
  } catch (err) {
    g.__sidifyYtPromise = null;
    throw err;
  }
}

/** True when the session booted without the JS player (native streaming unavailable). */
export function isEngineDegraded(): boolean {
  return !!g.__sidifyDegraded;
}

/** Drops the singleton so the next call rebuilds visitor data / player from scratch. */
export function resetYT(): void {
  g.__sidifyYt = null;
  g.__sidifyYtPromise = null;
  g.__sidifyDegraded = false;
  audioCache.clear();
}

/* ------------------------------ caching ------------------------------ */

interface CacheEntry<T> {
  at: number;
  data: T;
}

const searchCache = new Map<string, CacheEntry<any>>();
const channelCache = new Map<string, CacheEntry<any>>();
const albumCache = new Map<string, CacheEntry<any>>();
const audioCache = new Map<string, CacheEntry<ResolvedAudio | null>>();
const inflight = new Map<string, Promise<any>>();

const SEARCH_TTL = 10 * 60_000;
const CHANNEL_TTL = 30 * 60_000;
const ALBUM_TTL = 30 * 60_000;
const AUDIO_TTL = 90 * 60_000;
const AUDIO_NEG_TTL = 60_000;

/** Collapses duplicate concurrent work for the same key into one request. */
function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function normaliseQuery(query: string): string {
  // Strip control characters and cap length before it reaches InnerTube.
  return (query || "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 120);
}

export { isVideoId, ytThumbs, upscaleGstatic };

/* ------------------------------ search ------------------------------ */

export type SearchKind = "all" | "songs" | "albums" | "artists";

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

async function musicSearch(yt: YT, query: string, type?: "song" | "album" | "artist" | "video"): Promise<any> {
  return type ? yt.music.search(query, { type }) : yt.music.search(query);
}

/** Plain YouTube search — the last-resort fallback so songs are never empty. */
async function webSearchVideos(yt: YT, query: string): Promise<any> {
  return yt.search(query, { type: "video" });
}

/** Shared song-resolution ladder: filtered YTMusic shelf -> unfiltered -> plain YouTube. */
async function resolveTracks(yt: YT, q: string, wanted: number, useFiltered: boolean): Promise<Track[]> {
  if (useFiltered) {
    const filtered = await musicSearch(yt, q, "song").catch(() => null);
    if (filtered) {
      const tracks = classifyItems(flattenShelves(filtered), wanted).tracks;
      if (tracks.length) return tracks;
    }
  }

  const unfiltered = await musicSearch(yt, q).catch(() => null);
  if (unfiltered) {
    const tracks = classifyItems(flattenShelves(unfiltered), wanted).tracks;
    if (tracks.length) return tracks;
  }

  // Last resort so a search screen is never blank: plain YouTube video search.
  const web = await webSearchVideos(yt, q).catch(() => null);
  if (!web) return [];
  return flattenShelves(web.results ?? web)
    .map(toTrack)
    .filter(Boolean)
    .slice(0, wanted) as Track[];
}

async function runSearch(query: string, type: SearchKind, limit: number): Promise<SearchResult> {
  const yt = await getYT();
  const q = normaliseQuery(query);
  const cap = Math.min(Math.max(limit, 1), 30);

  /* ---- songs only ---- */
  if (type === "songs") {
    const tracks = await resolveTracks(yt, q, cap, true);
    return { tracks, albums: [], artists: [] };
  }

  /* ---- albums ---- */
  if (type === "albums") {
    const res = await musicSearch(yt, q, "album").catch(() => null);
    let albums = classifyItems(flattenShelves(res), cap).albums;
    if (!albums.length) {
      const any = await musicSearch(yt, q).catch(() => null);
      albums = classifyItems(flattenShelves(any), cap).albums;
    }
    if (!albums.length) {
      // No album shelf at all: fall back to pseudo albums built from song results.
      const tracks = await resolveTracks(yt, q, cap, true);
      albums = backfillFromTracks(tracks, [], []).albums;
    }
    return { tracks: [], albums, artists: [] };
  }

  /* ---- artists ---- */
  if (type === "artists") {
    const res = await musicSearch(yt, q, "artist").catch(() => null);
    let artists = classifyItems(flattenShelves(res), cap).artists;
    if (!artists.length) {
      const any = await musicSearch(yt, q).catch(() => null);
      artists = classifyItems(flattenShelves(any), cap).artists;
    }
    if (!artists.length) {
      const tracks = await resolveTracks(yt, q, cap, true);
      artists = backfillFromTracks(tracks, [], []).artists;
    }
    return { tracks: [], albums: [], artists };
  }

  /* ---- all: one unfiltered call, classify, then backfill what's missing ---- */
  const wanted = Math.max(8, Math.floor(cap / 2));
  const res = await musicSearch(yt, q).catch(() => null);
  const classified = classifyItems(flattenShelves(res), wanted);

  let tracks = classified.tracks;
  if (!tracks.length) tracks = await resolveTracks(yt, q, wanted, false);

  const filled = backfillFromTracks(tracks, classified.albums, classified.artists);
  return { tracks, albums: filled.albums.slice(0, 6), artists: filled.artists.slice(0, 6) };
}

/** Cached, deduplicated search used by every route. */
export async function ytSearch(query: string, type: SearchKind = "all", limit = 20): Promise<SearchResult> {
  const q = normaliseQuery(query);
  if (!q) return { tracks: [], albums: [], artists: [] };

  const key = `s:${q.toLowerCase()}:${type}:${limit}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.data as SearchResult;

  return dedupe(key, async () => {
    const result = await runSearch(q, type, limit);
    searchCache.set(key, { at: Date.now(), data: result });
    return result;
  });
}

/** Convenience wrapper matching the old `ytSearchTracks()` call sites. */
export async function ytSearchTracks(query: string, limit = 20): Promise<Track[]> {
  try {
    const { tracks } = await ytSearch(query, "songs", limit);
    return tracks;
  } catch (e) {
    console.error("ytSearchTracks error", (e as Error)?.message);
    return [];
  }
}

/* ------------------------------ artist / channel ------------------------------ */

export interface ChannelData {
  name: string;
  channelId?: string;
  tracks: Track[];
  albums: Album[];
}

async function runChannel(idOrName: string, limit: number): Promise<ChannelData | null> {
  const yt = await getYT();
  const isHandle = idOrName.startsWith("@");
  const isChannelId = /^UC[A-Za-z0-9_-]{8,}$/.test(idOrName);

  if (isChannelId) {
    // YouTube Music artist pages give the richest music-first result set.
    try {
      const artist = await yt.music.getArtist(idOrName);
      const items = flattenShelves((artist as any)?.sections ?? (artist as any)?.page ?? artist);
      const classified = classifyItems(items, limit);
      const header: any = artist?.header;
      const name =
        header?.title?.toString?.() ||
        header?.title?.text ||
        header?.strapline?.toString?.() ||
        classified.tracks[0]?.artist ||
        "";
      if (classified.tracks.length) {
        return {
          name: name || "Artist",
          channelId: idOrName,
          tracks: classified.tracks,
          albums: classified.albums,
        };
      }
    } catch {
      /* fall through to the channel parser */
    }
  }

  if (isChannelId || isHandle) {
    // Regular channel: videos tab. `Channel` is a TabbedFeed — it exposes `videos`
    // and `shelves` getters rather than a raw `contents` array.
    try {
      const channel: any = await yt.getChannel(idOrName);
      const items = flattenShelves(channel?.videos ?? channel?.shelves ?? channel?.page ?? channel);
      const classified = classifyItems(items, limit);
      if (classified.tracks.length) {
        return {
          name:
            channel?.metadata?.title ||
            channel?.header?.title?.toString?.() ||
            classified.tracks[0]?.artist ||
            "Artist",
          channelId: isHandle ? classified.tracks[0]?.artistId : idOrName,
          tracks: classified.tracks,
          albums: classified.albums,
        };
      }
    } catch {
      /* fall through to search */
    }
  }

  // Last resort: search by name.
  const { tracks, albums } = await runSearch(idOrName, "all", limit);
  if (!tracks.length) return null;
  return {
    name: tracks[0]?.artist || idOrName,
    channelId: tracks[0]?.artistId,
    tracks,
    albums,
  };
}

export async function ytChannelVideos(channelIdOrName: string, limit = 20): Promise<ChannelData | null> {
  const key = `c:${String(channelIdOrName).toLowerCase()}:${limit}`;
  const hit = channelCache.get(key);
  if (hit && Date.now() - hit.at < CHANNEL_TTL) return hit.data as ChannelData | null;

  return dedupe(key, async () => {
    let result: ChannelData | null = null;
    try {
      result = await runChannel(channelIdOrName, limit);
    } catch (e) {
      console.error("channel extract failed", (e as Error)?.message);
    }
    if (result) channelCache.set(key, { at: Date.now(), data: result });
    return result;
  });
}

/* ------------------------------ album ------------------------------ */

export interface AlbumData {
  album: Album;
  tracks: Track[];
}

/**
 * Resolves an album id to a tracklist.
 * Real YouTube Music ids (`MPR…`, `OLAK5uy…`, `MPREb…`) hit `music.getAlbum()`;
 * legacy `ytq-…` pseudo albums (still used by the home shelves and old links)
 * resolve to a grouped search, exactly as before.
 */
export async function ytAlbumTracks(albumId: string, limit = 20): Promise<AlbumData | null> {
  const key = `al:${albumId}:${limit}`;
  const hit = albumCache.get(key);
  if (hit && Date.now() - hit.at < ALBUM_TTL) return hit.data as AlbumData | null;

  return dedupe(key, async () => {
    let result: AlbumData | null = null;
    try {
      result = await runAlbum(albumId, limit);
    } catch (e) {
      console.error("album extract failed", (e as Error)?.message);
    }
    if (result) albumCache.set(key, { at: Date.now(), data: result });
    return result;
  });
}

async function runAlbum(albumId: string, limit: number): Promise<AlbumData | null> {
  const pseudo = isPseudoAlbumId(albumId) ? decodePseudoAlbum(albumId) : null;

  // Pseudo album: grouped search with a graceful fallback chain.
  if (pseudo || !/^(MPR|MPREb|OLAK5uy)/.test(albumId)) {
    const candidates = pseudo
      ? [pseudo.q, pseudo.t, pseudo.a ? `${pseudo.a} best songs` : ""]
      : [albumId];
    for (const cand of candidates) {
      if (!cand?.trim()) continue;
      const tracks = await ytSearchTracks(cand, limit);
      if (tracks.length) {
        return {
          album: {
            id: albumId,
            title: pseudo?.t || tracks[0]?.album || albumId,
            artist: pseudo?.a || tracks[0]?.artist || "Various Artists",
            artistId: tracks[0]?.artistId,
            artwork: tracks[0]?.artwork || "",
          },
          tracks,
        };
      }
    }
    return null;
  }

  const yt = await getYT();
  const album = await yt.music.getAlbum(albumId);
  const items = flattenShelves(album?.contents ?? album);
  const tracks = items.map(toTrack).filter(Boolean).slice(0, limit) as Track[];
  if (!tracks.length) return null;

  const header: any = album?.header;
  const headerName =
    header?.title?.toString?.() || header?.title?.text || header?.strapline?.toString?.() || "";
  const headerArtist =
    header?.author?.name ||
    header?.artists?.[0]?.name ||
    header?.subtitle?.runs?.find?.((r: any) => r?.endpoint)?.text ||
    "";
  const artwork =
    upscaleGstatic(
      album?.background?.contents?.[0]?.url ||
        (Array.isArray(album?.background) ? album?.background?.[0]?.url : "") ||
        header?.thumbnail?.contents?.[0]?.url ||
        ""
    ) || tracks[0]?.artwork || "";

  const first = flattenShelves(album?.contents)[0];
  return {
    album: {
      id: albumId,
      title: headerName || toAlbum(first)?.title || tracks[0]?.album || "Album",
      artist: headerArtist || tracks[0]?.artist || "Unknown Artist",
      artistId: tracks[0]?.artistId,
      artwork,
      trackCount: tracks.length,
      releaseDate: (first as any)?.year,
    },
    tracks,
  };
}

/* ------------------------------ audio resolution ------------------------------ */

export interface ResolvedAudio {
  url: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  itag?: number;
  mimeType?: string;
  contentLength?: number;
}

/**
 * InnerTube clients, best first for audio extraction:
 *  - ANDROID / TV_SIMPLY usually return pre-signed URLs that need no po_token
 *  - YTMUSIC_ANDROID / MWEB / WEB are progressively stricter (po_token, BotGuard)
 */
const STREAM_CLIENTS = ["ANDROID", "TV_SIMPLY", "YTMUSIC_ANDROID", "MWEB", "WEB"] as const;

function pickAudioFormat(info: any): any {
  // Spec path first: the library's own chooser (`type: 'audio'`, `quality: 'best'`,
  // which defaults to mp4/AAC — the most browser-compatible container).
  try {
    const chosen = info.chooseFormat({ type: "audio", quality: "best" });
    if (chosen && !chosen.is_type_otf) return chosen;
    if (chosen) return chosen;
  } catch {
    /* fall through to manual selection */
  }

  const formats: any[] = [
    ...(info?.streaming_data?.formats || []),
    ...(info?.streaming_data?.adaptive_formats || []),
  ];
  const audioOnly = formats
    .filter((f) => f?.has_audio && !f?.has_video && (f?.url || f?.signature_cipher || f?.cipher))
    // Non-OTF first: on-the-fly formats need explicit range juggling to scrub.
    .sort((a, b) => Number(!!a.is_type_otf) - Number(!!b.is_type_otf) || (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
  return audioOnly[0] || null;
}

async function resolveViaClient(yt: YT, videoId: string, client: string): Promise<ResolvedAudio | null> {
  try {
    const info = await yt.getBasicInfo(videoId, { client } as any);

    const status = info?.playability_status?.status;
    if (status && status !== "OK") return null;

    const format = pickAudioFormat(info);
    if (!format) return null;

    // `format.url` is already deciphered for most clients; `decipher()` covers the
    // signatureCipher case using the session's JS player.
    let url: string | undefined = format.url;
    if (!url) {
      try {
        url = await format.decipher(yt.session.player);
      } catch {
        url = undefined;
      }
    }
    if (!url) return null;

    const basic = info?.basic_info || {};
    const videoIdSafe = basic.id || videoId;
    const thumbs: any[] = basic.thumbnail || [];
    const bestThumb =
      [...thumbs].sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))[0]?.url || ytThumbs(videoIdSafe).hq;

    return {
      url: String(url),
      title: String(basic.title ?? ""),
      artist: String(basic.author ?? basic.channel?.name ?? ""),
      duration: Number(basic.duration ?? 0),
      thumbnail: String(bestThumb),
      itag: format.itag,
      mimeType: format.mime_type,
      contentLength: format.content_length ? Number(format.content_length) : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a playable, fully deciphered audio URL for a video id.
 * Cached (90 min positive / 60 s negative) and deduplicated; `skipCache` forces a
 * fresh resolution, which is what `/api/stream` uses after an upstream 403/410.
 */
export async function resolveAudio(videoId: string, skipCache = false): Promise<ResolvedAudio | null> {
  if (!isVideoId(videoId)) return null;

  const key = `a:${videoId}`;
  if (!skipCache) {
    const hit = audioCache.get(key);
    if (hit) {
      const ttl = hit.data ? AUDIO_TTL : AUDIO_NEG_TTL;
      if (Date.now() - hit.at < ttl) return hit.data;
    }
  }

  return dedupe(key, async () => {
    let yt: YT;
    try {
      yt = await getYT();
    } catch (e) {
      console.error("engine unavailable", (e as Error)?.message);
      return null;
    }

    for (const client of STREAM_CLIENTS) {
      const resolved = await resolveViaClient(yt, videoId, client);
      if (resolved?.url) {
        audioCache.set(key, { at: Date.now(), data: resolved });
        return resolved;
      }
    }

    // Visitor data / player script went stale — rebuild once and retry the fast
    // clients. Skipped in degraded mode: there is no player to re-fetch, so a rebuild
    // cannot help and the client simply falls back to the IFrame engine.
    if (!isEngineDegraded()) {
      resetYT();
      try {
        const fresh = await getYT();
        for (const client of STREAM_CLIENTS.slice(0, 2)) {
          const resolved = await resolveViaClient(fresh, videoId, client);
          if (resolved?.url) {
            audioCache.set(key, { at: Date.now(), data: resolved });
            return resolved;
          }
        }
      } catch {
        /* give up */
      }
    }

    audioCache.set(key, { at: Date.now(), data: null });
    return null;
  });
}
