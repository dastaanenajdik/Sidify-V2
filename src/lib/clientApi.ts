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

/**
 * A server that *answers* — even with an error status — is reachable.
 *
 * Only a transport failure (no response at all: offline, DNS, a dropped
 * connection) means the backend is really down. Treating a 5xx as "the backend is
 * down" used to silence every library request for a while, so one failing endpoint
 * took the whole library offline with it.
 */
class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API error ${status}`);
  }
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<T>;
}

const JSON_HDRS = { "content-type": "application/json" };

/* -------------------------------------------------------------------------- */
/*  Resilient library transport + in-flight GET deduplication.                 */
/*  `get`/`send` never throw: a 5xx, a missing DATABASE_URL or an offline      */
/*  device just yields `null`, and the caller keeps the change in the local     */
/*  library store (src/lib/localLibrary.ts). The server stays the source of     */
/*  truth whenever it answers, so nothing about the API contract changes.       */
/* -------------------------------------------------------------------------- */

const inflightJson = new Map<string, Promise<unknown>>();

function fetchJsonDedup<T>(url: string): Promise<T> {
  const existing = inflightJson.get(url) as Promise<T> | undefined;
  if (existing) return existing;
  const req = fetch(url)
    .then((r) => j<T>(r))
    .finally(() => {
      inflightJson.delete(url);
    });
  inflightJson.set(url, req);
  return req;
}

async function get<T>(path: string): Promise<T | null> {
  if (backendLooksDown()) return null;
  try {
    const out = await fetchJsonDedup<T>(path);
    markBackendUp();
    return out;
  } catch (error) {
    // The server answered: it is up, it just could not serve this request.
    if (error instanceof ApiError) return null;
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
  } catch (error) {
    // The server answered: it is up, it just could not store this change.
    if (error instanceof ApiError) return null;
    markBackendDown();
    return null;
  }
}

export const api = {
  home: (country: string) => fetchJsonDedup<HomeData>(`/api/home?country=${encodeURIComponent(country)}`),

  search: (q: string, type: string, country: string, limit = 20) =>
    fetchJsonDedup<SearchResults>(
      `/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&country=${encodeURIComponent(country)}&limit=${limit}`
    ),

  /** YouTube Music "Up next" radio for a track — what YTM would play after it. */
  radio: (videoId: string, limit = 12) =>
    fetchJsonDedup<{ tracks: Track[] }>(`/api/radio?video_id=${encodeURIComponent(videoId)}&limit=${limit}`),

  /** A cover for every Explore mood / genre tile. */
  explore: () => fetchJsonDedup<{ covers: Record<string, string> }>("/api/explore"),

  artist: (id: string) =>
    fetchJsonDedup<{ artist: Artist; songs: Track[]; albums: Album[] }>(`/api/artist/${encodeURIComponent(id)}`),

  album: (id: string) =>
    fetchJsonDedup<{ album: Album; tracks: Track[] }>(`/api/album/${encodeURIComponent(id)}`),

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

  downloads: async () => ({ downloads: (await get<{ downloads: DownloadRow[] }>("/api/downloads"))?.downloads ?? [] }),
  removeDownload: async (id: string) => {
    await send(`/api/downloads?id=${encodeURIComponent(id)}`, "DELETE");
    return { ok: true };
  },
  clearDownloads: async () => {
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

/** Downloads a track's audio through the proxy into IndexedDB, then registers it. */
export async function downloadTrack(
  track: Track,
  quality: string,
  onProgress?: (pct: number) => void
): Promise<number> {
  if (!track.videoId) throw new Error("Track not downloadable");
  const res = await fetch(`/api/stream?video_id=${track.videoId}&play=1`);
  if (!res.ok || !res.body) throw new Error("Download failed");
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total && onProgress) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
  }
  const blob = new Blob(chunks, { type: "audio/mp4" });
  await idbPut(track.id, blob);
  await send("/api/downloads", "POST", { track, quality, sizeBytes: blob.size });
  onProgress?.(100);
  return blob.size;
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
