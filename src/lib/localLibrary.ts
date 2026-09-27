"use client";

/**
 * Local-first library store.
 *
 * The server library (likes / history / playlists / follows / blocks) lives in Postgres.
 * Whenever that API is unreachable — no `DATABASE_URL`, missing tables, a 5xx from the
 * hosting provider, offline device — every write used to just disappear, so hearts,
 * "Add to playlist" and "New playlist" silently did nothing.
 *
 * This module keeps a durable copy of the user's library in `localStorage` and mirrors it
 * onto the server whenever the server answers. Reads merge both sources (server first,
 * local extras on top) and deduplicate by track id, so:
 *   - server up  -> nothing changes for the user, data still syncs
 *   - server down -> likes / playlists / history keep working on this device
 *
 * Playlists created locally use negative ids so they can never collide with the
 * server's serial ids. Tracks added to a *server* playlist while it was unreachable
 * are parked in `extras[playlistId]` and folded back in on read.
 */

import type { Artist, DownloadRow, FollowedArtistRow, PlaylistRow, Track } from "./types";

const KEY = "sidify-local-library";
const MAX_LIKED = 500;
const MAX_RECENT = 50;
const MAX_FOLLOWED = 200;
const MAX_BLOCKED = 200;
const MAX_DOWNLOADS = 400;

/**
 * After a failure we stop knocking on the same dead endpoint for a short while (so a
 * broken backend doesn't add a failed round-trip to every single interaction), then try
 * again — a backend that recovers is picked up again by itself.
 */
const BACKEND_COOLDOWN_MS = 20_000;

interface RecentEntry {
  track: Track;
  playedAt: number;
}

interface LocalLib {
  liked: (Track & { _likedAt?: number })[];
  /** Tracks the user un-liked while the server refused the DELETE. */
  likedRemoved: string[];
  recent: RecentEntry[];
  playlists: PlaylistRow[];
  /** Locally added tracks for server-side playlists, keyed by playlist id. */
  extras: Record<string, Track[]>;
  /** Track ids removed from a server-side playlist whose DELETE failed. */
  plRemoved: Record<string, string[]>;
  followed: (Artist & { _followedAt?: number })[];
  blocked: { artistId: string; name: string; blockedAt: string }[];
  /** Offline saves on this device (metadata for the IndexedDB blobs). */
  downloads: DownloadRow[];
  nextLocalId: number;
}

const EMPTY: LocalLib = {
  liked: [],
  likedRemoved: [],
  recent: [],
  playlists: [],
  extras: {},
  plRemoved: {},
  followed: [],
  blocked: [],
  downloads: [],
  nextLocalId: -1,
};

let backendDownUntil = 0;
let cache: { raw: string; data: LocalLib } | null = null;

/* ----------------------------- backend health ----------------------------- */

export function backendLooksDown(): boolean {
  return typeof window !== "undefined" && Date.now() < backendDownUntil;
}
export function markBackendDown(): void {
  backendDownUntil = Date.now() + BACKEND_COOLDOWN_MS;
}
export function markBackendUp(): void {
  backendDownUntil = 0;
}

/* -------------------------------- storage -------------------------------- */

function ssafe(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function read(): LocalLib {
  if (!ssafe()) return { ...EMPTY };
  const raw = window.localStorage.getItem(KEY) || "";
  if (cache && cache.raw === raw) return cache.data;
  let data: LocalLib = { ...EMPTY, liked: [], recent: [], playlists: [], extras: {}, plRemoved: {}, followed: [], blocked: [], likedRemoved: [], downloads: [] };
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<LocalLib>;
      data = {
        ...data,
        ...parsed,
        liked: Array.isArray(parsed.liked) ? parsed.liked : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
        followed: Array.isArray(parsed.followed) ? parsed.followed : [],
        blocked: Array.isArray(parsed.blocked) ? parsed.blocked : [],
        likedRemoved: Array.isArray(parsed.likedRemoved) ? parsed.likedRemoved : [],
        downloads: Array.isArray(parsed.downloads) ? parsed.downloads : [],
        extras: parsed.extras && typeof parsed.extras === "object" ? parsed.extras : {},
        plRemoved: parsed.plRemoved && typeof parsed.plRemoved === "object" ? parsed.plRemoved : {},
        nextLocalId: typeof parsed.nextLocalId === "number" && parsed.nextLocalId < 0 ? parsed.nextLocalId : -1,
      };
    } catch {
      /* corrupt payload -> start clean */
    }
  }
  cache = { raw, data };
  return data;
}

function write(mutate: (d: LocalLib) => void) {
  if (!ssafe()) return;
  const data = structuredCloneSafe(read());
  mutate(data);
  try {
    const raw = JSON.stringify(data);
    window.localStorage.setItem(KEY, raw);
    cache = { raw, data };
  } catch {
    /* quota — keep the in-memory copy for this session */
    cache = { raw: window.localStorage.getItem(KEY) || "", data };
  }
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return { ...v };
  }
}

/* --------------------------------- liked --------------------------------- */

export function likedLocally(track: Track) {
  write((d) => {
    if (d.liked.some((t) => t.id === track.id)) return;
    d.liked = [{ ...track, _likedAt: Date.now() }, ...d.liked].slice(0, MAX_LIKED);
    d.likedRemoved = d.likedRemoved.filter((id) => id !== track.id);
  });
}

export function unlikedLocally(trackId: string) {
  write((d) => {
    d.liked = d.liked.filter((t) => t.id !== trackId);
    if (!d.likedRemoved.includes(trackId)) d.likedRemoved = [trackId, ...d.likedRemoved].slice(0, 300);
  });
}

export function likedIdsLocal(): string[] {
  return read().liked.map((t) => t.id);
}

export function likedTracksLocal(): Track[] {
  return read().liked.map(({ _likedAt, ...t }) => t as Track);
}

/**
 * Local mirror first — it is kept in the exact order the user pressed the heart, so a
 * fresh like always lands on top — then anything the server knows about that this device
 * doesn't (e.g. liked from another browser).
 */
export function mergeLiked(server: Track[]): Track[] {
  const d = read();
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const t of d.liked) {
    if (!t?.id || seen.has(t.id) || d.likedRemoved.includes(t.id)) continue;
    seen.add(t.id);
    const { _likedAt, ...rest } = t;
    out.push(rest as Track);
  }
  for (const t of server) {
    if (!t?.id || seen.has(t.id) || d.likedRemoved.includes(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.slice(0, MAX_LIKED);
}

/** Ids this device has removed but the server may still be holding on to. */
export function likedRemovals(): string[] {
  return read().likedRemoved;
}

/* --------------------------------- recent -------------------------------- */

export function pushRecentLocal(track: Track) {
  write((d) => {
    d.recent = [{ track, playedAt: Date.now() }, ...d.recent.filter((r) => r.track.id !== track.id)].slice(0, MAX_RECENT);
  });
}

export function recentTracksLocal(): Track[] {
  return read().recent.map((r) => r.track);
}

export function clearRecentLocal() {
  write((d) => {
    d.recent = [];
  });
}

export function mergeRecent(server: Track[]): Track[] {
  const d = read();
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const r of d.recent) {
    if (!r?.track?.id || seen.has(r.track.id)) continue;
    seen.add(r.track.id);
    out.push(r.track);
  }
  for (const t of server) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out.slice(0, MAX_RECENT);
}

/* -------------------------------- playlists ------------------------------- */

export function isLocalPlaylistId(id: number) {
  return !Number.isFinite(id) || id <= 0;
}

export function createPlaylistLocal(name: string): PlaylistRow {
  const clean = (name || "").trim().slice(0, 80) || "New playlist";
  let created: PlaylistRow | null = null;
  write((d) => {
    const id = d.nextLocalId;
    d.nextLocalId = id - 1;
    created = { id, name: clean, createdAt: new Date().toISOString(), tracks: [] };
    d.playlists = [...d.playlists, created];
  });
  return created ?? { id: -1, name: clean, createdAt: new Date().toISOString(), tracks: [] };
}

export function deletePlaylistLocal(id: number) {
  write((d) => {
    d.playlists = d.playlists.filter((p) => p.id !== id);
    const k = String(id);
    if (d.extras[k]) {
      const { [k]: _drop, ...rest } = d.extras;
      d.extras = rest;
    }
    if (d.plRemoved[k]) {
      const { [k]: _drop, ...rest } = d.plRemoved;
      d.plRemoved = rest;
    }
  });
}

export function renamePlaylistLocal(id: number, name: string) {
  write((d) => {
    const p = d.playlists.find((x) => x.id === id);
    if (p) p.name = (name || "").trim().slice(0, 80) || p.name;
  });
}

export function trackAddToPlaylistLocal(id: number, track: Track) {
  write((d) => {
    const k = String(id);
    if (isLocalPlaylistId(id)) {
      const p = d.playlists.find((x) => x.id === id);
      if (!p) return;
      if (p.tracks.some((t) => t.id === track.id)) return;
      p.tracks = [...p.tracks, track];
      return;
    }
    const list = d.extras[k] ?? [];
    if (list.some((t) => t.id === track.id)) return;
    d.extras = { ...d.extras, [k]: [...list, track] };
    d.plRemoved = { ...d.plRemoved, [k]: (d.plRemoved[k] ?? []).filter((x) => x !== track.id) };
  });
}

export function trackRemoveFromPlaylistLocal(id: number, trackId: string) {
  write((d) => {
    const k = String(id);
    if (isLocalPlaylistId(id)) {
      const p = d.playlists.find((x) => x.id === id);
      if (p) p.tracks = p.tracks.filter((t) => t.id !== trackId);
      return;
    }
    if (d.extras[k]) d.extras = { ...d.extras, [k]: d.extras[k].filter((t) => t.id !== trackId) };
    const gone = d.plRemoved[k] ?? [];
    if (!gone.includes(trackId)) d.plRemoved = { ...d.plRemoved, [k]: [...gone, trackId].slice(-200) };
  });
}

function foldExtras(p: PlaylistRow, d: LocalLib): PlaylistRow {
  const k = String(p.id);
  const extras = d.extras[k];
  const removed = d.plRemoved[k];
  if (!extras?.length && !removed?.length) return p;
  const drop = new Set(removed ?? []);
  const base = p.tracks.filter((t) => !drop.has(t.id));
  const seen = new Set(base.map((t) => t.id));
  const additions = (extras ?? []).filter((t) => !drop.has(t.id) && !seen.has(t.id));
  return { ...p, tracks: [...base, ...additions] };
}

export function mergePlaylists(server: PlaylistRow[]): PlaylistRow[] {
  const d = read();
  const names = new Set<string>();
  const out: PlaylistRow[] = [];
  for (const p of server) {
    if (!p || typeof p.id !== "number" || p.id <= 0) continue;
    names.add(p.name.trim().toLowerCase());
    out.push(foldExtras(p, d));
  }
  for (const p of d.playlists) {
    // A locally created playlist whose name already exists upstream is the same one
    // the server has since taken over — don't show it twice.
    if (names.has(p.name.trim().toLowerCase())) continue;
    out.push(foldExtras(p, d));
  }
  return out;
}

/** Single playlist read (used by /playlist/[id]); `null` when it doesn't exist locally. */
export function playlistLocal(id: number, server: PlaylistRow | null): PlaylistRow | null {
  const d = read();
  if (server) return foldExtras(server, d);
  const own = d.playlists.find((p) => p.id === id);
  if (own) return own;
  // Server playlist that we can't reach right now: show what this device added.
  const extras = d.extras[String(id)];
  if (extras?.length) return { id, name: `Playlist #${id}`, createdAt: new Date().toISOString(), tracks: extras };
  return null;
}

export function localPlaylistIds(): number[] {
  return read().playlists.map((p) => p.id);
}

/* ------------------------------- downloads ------------------------------- */

/**
 * Downloads live in IndexedDB on this device — the server row is only metadata for the
 * list. Keeping a local copy of that metadata means a backend without a database (or an
 * offline device) still shows the songs that are actually saved, instead of an empty
 * Downloads page right after a successful save.
 */
export function downloadSavedLocal(track: Track, quality: string, sizeBytes: number) {
  write((d) => {
    const rest = (d.downloads ?? []).filter((r) => r.trackId !== track.id);
    d.downloads = [
      { trackId: track.id, track, quality: quality || "high", sizeBytes: sizeBytes || 0, downloadedAt: new Date().toISOString() },
      ...rest,
    ].slice(0, MAX_DOWNLOADS);
  });
}

export function downloadRemovedLocal(trackId: string) {
  write((d) => {
    d.downloads = (d.downloads ?? []).filter((r) => r.trackId !== trackId);
  });
}

export function clearDownloadsLocal() {
  write((d) => {
    d.downloads = [];
  });
}

export function downloadsLocal(): DownloadRow[] {
  return [...(read().downloads ?? [])];
}

export function downloadedIdsLocal(): string[] {
  return (read().downloads ?? []).map((r) => r.trackId);
}

/**
 * Server rows first (they carry the newest size/quality), then anything this device
 * saved that the server never heard about. Deduplicated by track id.
 */
export function mergeDownloads(server: DownloadRow[]): DownloadRow[] {
  const out: DownloadRow[] = [];
  const seen = new Set<string>();
  for (const r of server) {
    if (!r?.trackId || seen.has(r.trackId)) continue;
    seen.add(r.trackId);
    out.push(r);
  }
  for (const r of read().downloads ?? []) {
    if (!r?.trackId || seen.has(r.trackId)) continue;
    seen.add(r.trackId);
    out.push(r);
  }
  out.sort((a, b) => (b.downloadedAt || "").localeCompare(a.downloadedAt || ""));
  return out;
}

/* ----------------------------- artists / blocks ---------------------------- */

export function followArtistLocal(artist: Artist) {
  write((d) => {
    if (d.followed.some((a) => a.id === artist.id)) return;
    d.followed = [{ ...artist, _followedAt: Date.now() }, ...d.followed].slice(0, MAX_FOLLOWED);
  });
}

export function unfollowArtistLocal(id: string) {
  write((d) => {
    d.followed = d.followed.filter((a) => a.id !== id);
  });
}

export function mergeFollowed(server: FollowedArtistRow[]): FollowedArtistRow[] {
  const d = read();
  const seen = new Set<string>();
  const out: FollowedArtistRow[] = [];
  for (const r of server) {
    if (!r?.artistId) continue;
    seen.add(r.artistId);
    out.push(r);
  }
  for (const a of d.followed) {
    if (!a?.id || seen.has(a.id)) continue;
    seen.add(a.id);
    const { _followedAt, ...artist } = a;
    out.push({ artistId: artist.id, artist: artist as Artist, followedAt: new Date().toISOString() });
  }
  return out;
}

export function blockArtistLocal(artistId: string, name: string) {
  write((d) => {
    if (d.blocked.some((b) => b.artistId === artistId)) return;
    d.blocked = [{ artistId, name, blockedAt: new Date().toISOString() }, ...d.blocked].slice(0, MAX_BLOCKED);
  });
}

export function unblockArtistLocal(artistId: string) {
  write((d) => {
    d.blocked = d.blocked.filter((b) => b.artistId !== artistId);
  });
}

export function mergeBlocked(server: { artistId: string; name: string; blockedAt: string }[]) {
  const d = read();
  const seen = new Set<string>();
  const out = [...server];
  for (const a of server) seen.add(a.artistId);
  for (const b of d.blocked) {
    if (seen.has(b.artistId)) continue;
    out.push(b);
  }
  return out;
}

/* ------------------------------ bulk (restore) ----------------------------- */

export function exportLocalLibrary(): { liked: Track[]; recent: Track[]; playlists: PlaylistRow[] } {
  return { liked: likedTracksLocal(), recent: recentTracksLocal(), playlists: read().playlists };
}
