"use client";

import type { Album, Artist, DownloadRow, FollowedArtistRow, HomeData, PlaylistRow, Track } from "./types";
import { dropObjectUrl, idbClear, idbPut } from "./offlineDb";

export interface SearchResults {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
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

  liked: () => fetch("/api/library/liked").then((r) => j<{ tracks: Track[] }>(r)),
  like: (track: Track) =>
    fetch("/api/library/liked", { method: "POST", body: JSON.stringify({ track }) }).then((r) => j<{ ok: boolean }>(r)),
  unlike: (id: string) =>
    fetch(`/api/library/liked?id=${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  recent: () => fetch("/api/library/recent").then((r) => j<{ tracks: Track[] }>(r)),
  pushRecent: (track: Track) =>
    fetch("/api/library/recent", { method: "POST", body: JSON.stringify({ track }) }).catch(() => {}),
  clearRecent: () => fetch("/api/library/recent", { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  downloads: () => fetch("/api/downloads").then((r) => j<{ downloads: DownloadRow[] }>(r)),
  removeDownload: (id: string) => fetch(`/api/downloads?id=${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  clearDownloads: () => fetch("/api/downloads", { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  followed: () => fetch("/api/library/followed").then((r) => j<{ artists: FollowedArtistRow[] }>(r)),
  follow: (artist: Artist) =>
    fetch("/api/library/followed", { method: "POST", body: JSON.stringify({ artist }) }).then((r) => j<{ ok: boolean }>(r)),
  unfollow: (id: string) =>
    fetch(`/api/library/followed?id=${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  blocked: () =>
    fetch("/api/library/blocked").then((r) =>
      j<{ artists: { artistId: string; name: string; blockedAt: string }[] }>(r)
    ),
  block: (artistId: string, name: string) =>
    fetch("/api/library/blocked", { method: "POST", body: JSON.stringify({ artistId, name }) }).then((r) =>
      j<{ ok: boolean }>(r)
    ),
  unblock: (id: string) => fetch(`/api/library/blocked?id=${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  playlists: () => fetch("/api/playlists").then((r) => j<{ playlists: PlaylistRow[] }>(r)),
  createPlaylist: (name: string) =>
    fetch("/api/playlists", { method: "POST", body: JSON.stringify({ name }) }).then((r) =>
      j<{ playlist: PlaylistRow }>(r)
    ),
  renamePlaylist: (id: number, name: string) =>
    fetch(`/api/playlists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }).then((r) => j<{ ok: boolean }>(r)),
  deletePlaylist: (id: number) => fetch(`/api/playlists/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),
  addToPlaylist: (id: number, track: Track) =>
    fetch(`/api/playlists/${id}`, { method: "POST", body: JSON.stringify({ track }) }).then((r) => j<{ ok: boolean }>(r)),
  removeFromPlaylist: (id: number, trackId: string) =>
    fetch(`/api/playlists/${id}?trackId=${trackId}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  restore: (payload: unknown) =>
    fetch("/api/library/restore", { method: "POST", body: JSON.stringify(payload) }).then((r) =>
      j<{ ok: boolean; restored: number }>(r)
    ),
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
  await fetch("/api/downloads", {
    method: "POST",
    body: JSON.stringify({ track, quality, sizeBytes: blob.size }),
  });
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
