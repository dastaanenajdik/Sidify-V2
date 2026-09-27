"use client";

import type { Album, Artist, DownloadRow, FollowedArtistRow, HomeData, PlaylistRow, Track } from "./types";
import { dropObjectUrl, idbClear, idbPut } from "./offlineDb";
import {
  backendLooksDown,
  blockArtistLocal,
  clearRecentLocal,
  createPlaylistLocal,
  deletePlaylistLocal,
  followArtistLocal,
  isLocalPlaylistId,
  likedLocally,
  markBackendDown,
  markBackendUp,
  mergeBlocked,
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

  downloads: () => fetch("/api/downloads").then((r) => j<{ downloads: DownloadRow[] }>(r)),
  removeDownload: (id: string) => fetch(`/api/downloads?id=${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  clearDownloads: () => fetch("/api/downloads", { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

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
const DOWNLOAD_RETRIES = 3;

export interface FetchedAudio {
  blob: Blob;
  mime: string;
  size: number;
}

function parseContentRange(header: string | null): { end: number; total: number } | null {
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header || "");
  if (!m) return null;
  return { end: Number(m[2]), total: m[3] === "*" ? 0 : Number(m[3]) };
}

async function fetchWithRetry(url: string, init: RequestInit, tries = DOWNLOAD_RETRIES): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, init);
      // 503 = resolver hiccup, 5xx = upstream wobble: both are worth one more go.
      if (res.status >= 500 && attempt < tries - 1) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if ((err as { name?: string })?.name === "AbortError") throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Download failed");
}

/**
 * Pulls a track's full audio through the same `/api/stream` proxy that playback uses,
 * in sequential Range chunks, and returns it as a Blob with its real MIME type.
 */
export async function fetchTrackAudio(
  track: Track,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<FetchedAudio> {
  if (!track.videoId) throw new Error("Track not downloadable");
  const url = `/api/stream?video_id=${encodeURIComponent(track.videoId)}&play=1`;
  const chunks: BlobPart[] = [];
  let mime = "";
  let loaded = 0;
  let total = 0;

  for (;;) {
    const res = await fetchWithRetry(url, {
      headers: { range: `bytes=${loaded}-${loaded + DOWNLOAD_CHUNK - 1}` },
      cache: "no-store",
      signal,
    });
    // Asked past the end of a file whose size we never learned: we already have it all.
    if (res.status === 416 && loaded > 0) break;
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    mime = mime || (res.headers.get("content-type") || "").split(";")[0].trim();

    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    loaded += buf.byteLength;

    if (res.status !== 206) {
      // The proxy answered with the whole file (no Range support upstream): one and done.
      total = loaded;
      break;
    }
    const cr = parseContentRange(res.headers.get("content-range"));
    if (cr?.total) total = cr.total;
    if (total && onProgress) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
    if (total ? loaded >= total : buf.byteLength < DOWNLOAD_CHUNK) break;
    if (buf.byteLength === 0) throw new Error("Download stalled");
  }

  const blob = new Blob(chunks, { type: mime || "audio/mp4" });
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
  await idbPut(track.id, blob);
  await fetch("/api/downloads", {
    method: "POST",
    body: JSON.stringify({ track, quality, sizeBytes: blob.size }),
  });
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
  await mod.idbDelete(trackId);
  await api.removeDownload(trackId);
}

export async function clearAllDownloads() {
  await idbClear();
  await api.clearDownloads();
}
