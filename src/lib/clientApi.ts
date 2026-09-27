"use client";

import type { Album, Artist, DownloadRow, FollowedArtistRow, HomeData, PlaylistRow, Track } from "./types";
import { dropObjectUrl, idbClear, idbPut } from "./offlineDb";
import {
  backendLooksDown,
  blockArtistLocal,
  clearDownloadsLocal,
  clearRecentLocal,
  createPlaylistLocal,
  deletePlaylistLocal,
  downloadRemovedLocal,
  downloadSavedLocal,
  followArtistLocal,
  isLocalPlaylistId,
  likedLocally,
  markBackendDown,
  markBackendUp,
  mergeBlocked,
  mergeDownloads,
  mergeFollowed,
  mergeLiked,
  mergePlaylists,
  mergeRecent,
  playlistLocal,
  pushRecentLocal,
  renamePlaylistLocal,
  trackAddToPlaylistLocal,
  trackRemoveFromPlaylistLocal,
  unlikedLocally,
  unblockArtistLocal,
  unfollowArtistLocal,
} from "./localLibrary";

export interface SearchResults {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

const JSON_HDRS = { "content-type": "application/json" };

/* -------------------------------------------------------------------------- */
/*  Resilient library transport.                                               */
/*  `get`/`send` never throw: a 5xx, a missing DATABASE_URL or an offline      */
/*  device just yields `null`, and the caller keeps the change in the local     */
/*  library store (src/lib/localLibrary.ts). The server stays the source of     */
/*  truth whenever it answers, so nothing about the API contract changes.       */
/* -------------------------------------------------------------------------- */

async function get<T>(path: string): Promise<T | null> {
  if (backendLooksDown()) return null;
  try {
    const out = await j<T>(await fetch(path));
    markBackendUp();
    return out;
  } catch {
    markBackendDown();
    return null;
  }
}

async function send<T = { ok: boolean }>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T | null> {
  if (backendLooksDown()) return null;
  try {
    const out = await j<T>(
      await fetch(path, { method, headers: body === undefined ? undefined : JSON_HDRS, body: body === undefined ? undefined : JSON.stringify(body) })
    );
    markBackendUp();
    return out;
  } catch {
    markBackendDown();
    return null;
  }
}

export const api = {
  home: (country: string) => fetch(`/api/home?country=${country}`).then((r) => j<HomeData>(r)),

  search: (q: string, type: string, country: string, limit = 20) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}&country=${country}&limit=${limit}`).then((r) =>
      j<SearchResults>(r)
    ),

  artist: (id: string) =>
    fetch(`/api/artist/${id}`).then((r) => j<{ artist: Artist; songs: Track[]; albums: Album[] }>(r)),

  album: (id: string) => fetch(`/api/album/${id}`).then((r) => j<{ album: Album; tracks: Track[] }>(r)),

  /* --------------------------------- liked --------------------------------- */
  liked: async () => ({ tracks: mergeLiked((await get<{ tracks: Track[] }>("/api/library/liked"))?.tracks ?? []) }),
  like: async (track: Track) => {
    likedLocally(track);
    await send("/api/library/liked", "POST", { track });
    return { ok: true };
  },
  unlike: async (id: string) => {
    unlikedLocally(id);
    await send(`/api/library/liked?id=${encodeURIComponent(id)}`, "DELETE");
    return { ok: true };
  },

  /* --------------------------------- recent -------------------------------- */
  recent: async () => ({ tracks: mergeRecent((await get<{ tracks: Track[] }>("/api/library/recent"))?.tracks ?? []) }),
  pushRecent: async (track: Track) => {
    pushRecentLocal(track);
    await send("/api/library/recent", "POST", { track });
  },
  clearRecent: async () => {
    clearRecentLocal();
    await send("/api/library/recent", "DELETE");
    return { ok: true };
  },

  // Downloads are stored on the device (IndexedDB); the server list is only metadata.
  // Like every other library read it merges a local mirror, so a missing database no
  // longer empties the Downloads page of songs that really are saved offline.
  downloads: async () => ({ downloads: mergeDownloads((await get<{ downloads: DownloadRow[] }>("/api/downloads"))?.downloads ?? []) }),
  removeDownload: async (id: string) => {
    downloadRemovedLocal(id);
    await send(`/api/downloads?id=${encodeURIComponent(id)}`, "DELETE");
    return { ok: true };
  },
  clearDownloads: async () => {
    clearDownloadsLocal();
    await send("/api/downloads", "DELETE");
    return { ok: true };
  },

  /* -------------------------------- followed -------------------------------- */
  followed: async () => ({
    artists: mergeFollowed((await get<{ artists: FollowedArtistRow[] }>("/api/library/followed"))?.artists ?? []),
  }),
  follow: async (artist: Artist) => {
    followArtistLocal(artist);
    await send("/api/library/followed", "POST", { artist });
    return { ok: true };
  },
  unfollow: async (id: string) => {
    unfollowArtistLocal(id);
    await send(`/api/library/followed?id=${encodeURIComponent(id)}`, "DELETE");
    return { ok: true };
  },

  /* --------------------------------- blocked -------------------------------- */
  blocked: async () => ({
    artists: mergeBlocked((await get<{ artists: { artistId: string; name: string; blockedAt: string }[] }>("/api/library/blocked"))?.artists ?? []),
  }),
  block: async (artistId: string, name: string) => {
    blockArtistLocal(artistId, name);
    await send("/api/library/blocked", "POST", { artistId, name });
    return { ok: true };
  },
  unblock: async (id: string) => {
    unblockArtistLocal(id);
    await send(`/api/library/blocked?id=${encodeURIComponent(id)}`, "DELETE");
    return { ok: true };
  },

  /* -------------------------------- playlists ------------------------------- */
  playlists: async () => ({ playlists: mergePlaylists((await get<{ playlists: PlaylistRow[] }>("/api/playlists"))?.playlists ?? []) }),

  playlist: async (id: number | string): Promise<PlaylistRow> => {
    const pid = Number(id);
    const remote = isLocalPlaylistId(pid)
      ? null
      : await get<{ playlist: PlaylistRow }>(`/api/playlists/${pid}`).then((d) => d?.playlist ?? null);
    const local = playlistLocal(pid, remote);
    if (!local) throw new Error("Not found");
    return local;
  },

  createPlaylist: async (name: string) => {
    const clean = (name || "").trim().slice(0, 80);
    const remote = clean ? await send<{ playlist: PlaylistRow }>("/api/playlists", "POST", { name: clean }) : null;
    if (remote?.playlist) return { playlist: remote.playlist };
    return { playlist: createPlaylistLocal(clean || "New playlist") };
  },
  renamePlaylist: async (id: number, name: string) => {
    renamePlaylistLocal(id, name);
    if (!isLocalPlaylistId(id)) await send(`/api/playlists/${id}`, "PATCH", { name });
    return { ok: true };
  },
  deletePlaylist: async (id: number) => {
    deletePlaylistLocal(id);
    if (!isLocalPlaylistId(id)) await send(`/api/playlists/${id}`, "DELETE");
    return { ok: true };
  },
  addToPlaylist: async (id: number, track: Track) => {
    trackAddToPlaylistLocal(id, track);
    if (!isLocalPlaylistId(id)) await send(`/api/playlists/${id}`, "POST", { track });
    return { ok: true };
  },
  removeFromPlaylist: async (id: number, trackId: string) => {
    trackRemoveFromPlaylistLocal(id, trackId);
    if (!isLocalPlaylistId(id)) await send(`/api/playlists/${id}?trackId=${encodeURIComponent(trackId)}`, "DELETE");
    return { ok: true };
  },

  restore: async (payload: unknown) => {
    const data = (payload || {}) as { liked?: Track[]; followed?: Artist[] };
    let local = 0;
    for (const t of data.liked ?? []) {
      if (!t?.id) continue;
      likedLocally(t);
      local++;
    }
    for (const a of data.followed ?? []) {
      if (!a?.id) continue;
      followArtistLocal(a);
      local++;
    }
    const res = await send<{ ok: boolean; restored: number }>("/api/library/restore", "POST", payload);
    return { ok: true, restored: res?.restored ?? local };
  },
};

/* ------------------------------- downloads -------------------------------- */

/** Size of one Range request when saving a track. Small enough that every request
 *  finishes in a few seconds even on a slow mobile link — the stream proxy runs as a
 *  serverless function with a hard 60 s cap, so one giant request could be cut off
 *  half-way; short chunks also survive the CDN closing long-lived connections. */
const DOWNLOAD_CHUNK = 2 * 1024 * 1024;
/** Attempts *per chunk*. A retry resumes at the byte we already have, it never
 *  restarts the file — a mobile connection that drops mid-body is the normal case, not
 *  the exception, and restarting from zero is what used to end in "Download failed". */
const DOWNLOAD_ATTEMPTS = 4;
/** Backoff after attempt n (ms) when the attempt produced nothing. Deliberately
 *  patient: the proxy re-resolves the YouTube URL when the CDN rejects it, and that
 *  takes a few seconds. Capped so a video that is simply gone fails in ~5 s, not 20. */
const DOWNLOAD_BACKOFF = [800, 1600, 2500];
/** An attempt that *did* deliver bytes means the link is alive — go again at once. */
const PROGRESS_BACKOFF = 250;
/** A request that delivers nothing for this long is dead, not slow: abort it and resume
 *  from the last byte we got. Without this a black-holed mobile connection leaves the
 *  download (and its progress toast) spinning forever with nothing to report. */
const INACTIVITY_TIMEOUT_MS = 20_000;

export interface DownloadOptions {
  /** Overrides the inactivity watchdog — used by the tests, and by callers that know
   *  they are on a very slow link. */
  inactivityMs?: number;
}

export interface FetchedAudio {
  blob: Blob;
  mime: string;
  size: number;
}

function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header || "");
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === "*" ? 0 : Number(m[3]) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Drains a response body slice by slice instead of `arrayBuffer()`.
 *
 * Two reasons: the caller can report a live percentage while the bytes are still
 * arriving (a 2 MB chunk on a phone takes long enough that "no movement" reads as
 * "broken"), and a connection that dies half-way keeps the slices it already
 * delivered — the next attempt simply asks for the remainder.
 */
async function readBody(res: Response, onSlice: (slice: Uint8Array) => void): Promise<number> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength) onSlice(buf);
    return buf.byteLength;
  }
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) {
        onSlice(value);
        bytes += value.byteLength;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  return bytes;
}

type ChunkOutcome =
  | { kind: "end" }
  | { kind: "slice"; status: number; mime: string; range: ReturnType<typeof parseContentRange>; bytes: number };

/**
 * Fetches one Range slice, retrying from the *current* offset.
 *
 * `offset()` is read again on every attempt, so a retry asks for the bytes after the
 * ones that already landed instead of re-requesting the start of the slice.
 * `onFailure` tells the caller whether those bytes are still usable: on a 206 they are
 * (the next request continues after them), on a plain 200 — a proxy that ignores Range
 * and re-sends the whole file — they are not and must be dropped.
 */
async function fetchChunk(
  url: string,
  offset: () => number,
  onSlice: (slice: Uint8Array) => void,
  onFailure: (keepPartial: boolean) => void,
  inactivityMs: number,
  signal?: AbortSignal
): Promise<ChunkOutcome> {
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    const at = offset();
    /** Wait before the next attempt — short when the last one was making progress. */
    const breathe = () => sleep(offset() > at ? PROGRESS_BACKOFF : DOWNLOAD_BACKOFF[Math.min(attempt, DOWNLOAD_BACKOFF.length - 1)]);

    // Our own controller, so the watchdog can kill just this attempt while still
    // honouring a caller-side cancel (which must abort the whole download).
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    let idle = setTimeout(() => ctrl.abort(), inactivityMs);
    const stopWatch = () => {
      clearTimeout(idle);
      signal?.removeEventListener("abort", onOuterAbort);
    };
    const bump = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), inactivityMs);
    };
    /** True when *we* timed the attempt out, rather than the caller cancelling. */
    const stalled = () => !signal?.aborted && ctrl.signal.aborted;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { range: `bytes=${at}-${at + DOWNLOAD_CHUNK - 1}` },
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (err) {
      stopWatch();
      if (signal?.aborted) throw err;
      lastErr = stalled() ? new Error("Download stalled") : err;
      if (attempt < DOWNLOAD_ATTEMPTS - 1) await breathe();
      continue;
    }

    // Asked past the end of the file: everything before this is already ours.
    if (res.status === 416) {
      stopWatch();
      return { kind: "end" };
    }
    // 503 = the resolver could not get a URL this moment, 5xx = upstream wobble.
    if (res.status >= 500) {
      stopWatch();
      lastErr = new Error(`Download failed (${res.status})`);
      if (attempt < DOWNLOAD_ATTEMPTS - 1) await breathe();
      continue;
    }
    // 4xx (400/403/404) is a verdict, not a hiccup — retrying cannot change it.
    if (!res.ok) {
      stopWatch();
      throw new Error(`Download failed (${res.status})`);
    }

    const partial = res.status === 206;
    try {
      const bytes = await readBody(res, (slice) => {
        bump();
        onSlice(slice);
      });
      stopWatch();
      return {
        kind: "slice",
        status: res.status,
        mime: (res.headers.get("content-type") || "").split(";")[0].trim(),
        range: parseContentRange(res.headers.get("content-range")),
        bytes,
      };
    } catch (err) {
      stopWatch();
      if (signal?.aborted) throw err;
      // The transfer broke mid-body (or went quiet). Keep the 206 bytes we did receive
      // and continue after them; a full-body 200 has to be re-requested from the start.
      lastErr = stalled() ? new Error("Download stalled") : err;
      onFailure(partial);
      if (attempt < DOWNLOAD_ATTEMPTS - 1) await breathe();
      continue;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Download failed");
}

/**
 * Non-blocking companion request: the JSON mode of the same route answers with the
 * file's real `content_length`, which is what turns "downloading…" into an honest
 * percentage from the very first byte — and asking for it warms the server-side
 * resolver, so the byte requests that follow usually hit a warm cache.
 * It is fired in parallel and never delays the first Range request.
 */
async function probeMediaSize(videoId: string, meta: { total: number }): Promise<void> {
  try {
    const res = await fetch(`/api/stream?video_id=${encodeURIComponent(videoId)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { content_length?: number | null };
    const size = Number(data?.content_length);
    if (Number.isFinite(size) && size > 0 && !meta.total) meta.total = size;
  } catch {
    /* the 206 Content-Range carries the same number */
  }
}

/** Signals "the upstream handed us a different file than the one we started with". */
class DownloadRestart extends Error {}

/**
 * Pulls a track's full audio through the same `/api/stream` proxy that playback uses,
 * in sequential Range chunks, and returns it as a Blob with its real MIME type.
 * Progress is reported per network slice (0-99), so the UI can show a live percentage.
 */
export async function fetchTrackAudio(
  track: Track,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
  opts?: DownloadOptions
): Promise<FetchedAudio> {
  if (!track.videoId) throw new Error("Track not downloadable");
  const url = `/api/stream?video_id=${encodeURIComponent(track.videoId)}&play=1`;
  const meta = { total: 0 };
  void probeMediaSize(track.videoId, meta).catch(() => {});

  /** A stream reader hands out `Uint8Array<ArrayBufferLike>`; `Blob` types its parts as
   *  `ArrayBufferView<ArrayBuffer>`. Same bytes, narrower type — bridged at the `new Blob`
   *  call below rather than by copying every slice. */
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let mime = "";
  let loaded = 0;
  let lastPct = -1;

  const report = () => {
    if (!onProgress || !(meta.total > 0)) return;
    const pct = Math.min(99, Math.max(1, Math.round((loaded / meta.total) * 100)));
    if (pct === lastPct) return;
    lastPct = pct;
    onProgress(pct);
  };
  const take = (slice: Uint8Array) => {
    chunks.push(slice);
    loaded += slice.byteLength;
    report();
  };

  for (;;) {
    const out = await fetchChunk(
      url,
      () => loaded,
      take,
      (keepPartial) => {
        if (keepPartial) return;
        // A full-body response died halfway: those bytes cannot be resumed, drop them.
        chunks.length = 0;
        loaded = 0;
        lastPct = -1;
      },
      opts?.inactivityMs ?? INACTIVITY_TIMEOUT_MS,
      signal
    );

    if (out.kind === "end") {
      if (loaded === 0) throw new Error("Download stalled");
      break;
    }

    mime = mime || out.mime;

    if (out.status !== 206) {
      // The proxy answered with the whole file (no Range support upstream): one and done.
      if (!out.bytes) throw new Error("Download stalled");
      meta.total = loaded;
      break;
    }

    if (!out.bytes) throw new Error("Download stalled");
    const range = out.range;
    // The slice has to start exactly where we stopped, or the file would have a hole.
    if (range && range.start !== loaded - out.bytes) {
      throw new DownloadRestart(`stream jumped to byte ${range.start}`);
    }
    if (range?.total && meta.total && range.total !== meta.total) {
      // A re-resolve picked a different format/length: continuing would splice two
      // different encodings into one file. Start over against the new one.
      throw new DownloadRestart(`stream length changed (${meta.total} → ${range.total})`);
    }
    if (range?.total) meta.total = range.total;
    if (meta.total && loaded >= meta.total) break;
  }

  if (!loaded) throw new Error("Download stalled");
  // Truncated files play as silence-then-cut: better to say so than to cache them.
  if (meta.total && loaded < meta.total) {
    throw new Error(`Download incomplete (${Math.round((loaded / meta.total) * 100)}%)`);
  }

  const blob = new Blob(chunks as unknown as BlobPart[], { type: mime || "audio/mp4" });
  onProgress?.(99);
  return { blob, mime: blob.type, size: blob.size };
}

/** Downloads a track's audio through the proxy into IndexedDB, then registers it. */
export async function downloadTrack(
  track: Track,
  quality: string,
  onProgress?: (pct: number) => void
): Promise<number> {
  const { blob } = await fetchTrackAudio(track, onProgress);
  if (!blob.size) throw new Error("Download stalled");
  await idbPut(track.id, blob);
  downloadSavedLocal(track, quality, blob.size);
  // The server row is a convenience (it lets other devices see the list). Losing it
  // must never undo a download that is already on this device.
  await send("/api/downloads", "POST", { track, quality, sizeBytes: blob.size });
  onProgress?.(100);
  return blob.size;
}

/** Hands a Blob to the browser's download manager under the given file name. */
export function saveBlobToDevice(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Give the download manager a moment to grab the URL before revoking it.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(href);
  }, 60_000);
}

export async function removeDownloadEverywhere(trackId: string) {
  dropObjectUrl(trackId);
  const mod = await import("./offlineDb");
  await mod.idbDelete(trackId).catch(() => {});
  await api.removeDownload(trackId);
}

export async function clearAllDownloads() {
  await idbClear().catch(() => {});
  await api.clearDownloads();
}
