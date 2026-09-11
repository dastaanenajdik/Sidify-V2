/**
 * Sidify — YouTube response parser (pure transforms, no I/O).
 *
 * `youtubei.js` hands back deeply nested, *parsed* YTNode objects (MusicShelf,
 * MusicCardShelf, ItemSection, MusicResponsiveListItem, MusicTwoRowItem, Video...).
 * Depending on the search filter those live in different places, and the library's
 * own `Search.songs` / `.albums` getters match shelves by their **English title
 * string**, which silently returns `undefined` on any other locale.
 *
 * So instead of trusting titles we walk the whole tree and classify every leaf by
 * its *id shape* — that is locale independent and never yields empty arrays when
 * YouTube merely re-arranged the shelves.
 *
 * The same helpers also accept raw JSON (plain objects), which keeps them usable
 * from tests and from any endpoint that returns un-parsed InnerTube payloads.
 */
import type { Album, Artist, Track } from "./types";

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (v: unknown): v is string => typeof v === "string" && VIDEO_ID_RE.test(v);

/** YouTube Music browse ids. Albums are `MPR…` / `OLAK5uy…` / `MPREb…`, artists & channels are `UC…`. */
const ALBUM_ID_RE = /^(MPR|MPREb|OLAK5uy|FEmusic)/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{8,}$/;

/* ------------------------------ thumbnails ------------------------------ */

export function ytThumbs(videoId: string) {
  return {
    maxres: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    def: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
  };
}

/**
 * YouTube Music artwork is served from `lh3.googleusercontent.com` with a size
 * suffix such as `=w60-h60-l90-rj`. Rewriting that suffix asks the CDN for a
 * bigger rendition — no UI change needed, cards simply receive sharper art.
 */
export function upscaleGstatic(url: string, size = 600): string {
  if (!url) return url;
  if (!/googleusercontent\.com|ggpht\.com/.test(url)) return url;
  const stripped = url.replace(/=.*$/, "");
  return `${stripped}=w${size}-h${size}-l90-rj`;
}

function readText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v.text === "string") return v.text;
  if (Array.isArray(v.runs)) return v.runs.map((r: any) => r?.text ?? "").join("");
  if (typeof v.toString === "function") {
    const s = v.toString();
    return s === "[object Object]" ? "" : s;
  }
  return "";
}

/** `"3:45"` / `"1:02:03"` -> seconds. */
export function durationTextToSeconds(text?: string): number {
  if (!text) return 0;
  const clean = String(text).trim();
  if (/^\d+$/.test(clean)) return Number(clean);
  const parts = clean.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function collectThumbnails(node: any): string[] {
  const out: string[] = [];
  const push = (list: any) => {
    if (!Array.isArray(list)) return;
    for (const t of list) {
      const url = typeof t === "string" ? t : t?.url;
      if (typeof url === "string" && url) out.push(url);
    }
  };
  push(node?.thumbnails);
  const th = node?.thumbnail;
  if (th) {
    if (Array.isArray(th)) push(th);
    else if (Array.isArray(th.contents)) push(th.contents);
    else if (typeof th.url === "string") out.push(th.url);
  }
  return out;
}

function pickThumbnailUrl(node: any): string {
  const urls = collectThumbnails(node);
  if (!urls.length) return "";
  // Prefer the largest square-ish rendition; skip animated/webp placeholders.
  const scored = urls
    .filter((u) => !u.endsWith(".webp"))
    .map((u) => {
      const m = u.match(/[?&/=]w(\d+)/) || u.match(/(\d+)x(\d+)/);
      const w = m ? Number(m[1]) : 0;
      return { u, w };
    });
  scored.sort((a, b) => b.w - a.w);
  const best = (scored[0] || urls[urls.length - 1]).u ?? urls[urls.length - 1];
  return upscaleGstatic(best);
}

/* ------------------------------ flat item ------------------------------ */

/** Normalised, source-agnostic representation of one search/browse result. */
export interface FlatItem {
  id: string;
  /** Raw id shape: a video id, or a YouTube Music browse id. */
  itemType: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  durationSecs: number;
  thumbnail: string;
  year?: string;
}

function extractId(node: any): string {
  const direct = node?.id ?? node?.video_id ?? node?.videoId ?? node?.browseId ?? node?.browse_id;
  if (typeof direct === "string" && direct) return direct;
  const payload = node?.endpoint?.payload;
  if (payload) {
    const p = payload.videoId ?? payload.browseId ?? payload.playlistId;
    if (typeof p === "string" && p) return p;
  }
  const cmd = node?.endpoint?.metadata?.url;
  if (typeof cmd === "string") {
    const m = cmd.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return "";
}

function extractArtist(node: any): { name: string; id?: string } {
  const pools: any[] = [];
  if (Array.isArray(node?.artists)) pools.push(...node.artists);
  if (Array.isArray(node?.authors)) pools.push(...node.authors);
  if (node?.artist && typeof node.artist === "object") pools.push(node.artist);
  if (node?.author && typeof node.author === "object") pools.push(node.author);

  for (const a of pools) {
    const name = readText(a?.name) || readText(a?.title);
    if (name) {
      const id = a?.channel_id ?? a?.id ?? a?.browseId ?? a?.endpoint?.payload?.browseId;
      return { name, id: typeof id === "string" && id ? id : undefined };
    }
  }
  // `name` is what artist rows use instead of `title`.
  if (typeof node?.name === "string" && node.name) {
    const id = typeof node?.id === "string" ? node.id : undefined;
    return { name: node.name, id };
  }
  return { name: "", id: undefined };
}

/** Turns any supported node into a FlatItem, or `null` when it isn't a leaf item. */
export function toFlatItem(node: any): FlatItem | null {
  if (!node || typeof node !== "object") return null;

  const id = extractId(node);
  if (!id) return null;

  const rawType: string =
    (typeof node?.item_type === "string" && node.item_type) ||
    (typeof node?.type === "string" ? node.type : "") ||
    "";

  const title = readText(node?.title) || readText(node?.name) || "";
  const { name: artist, id: artistId } = extractArtist(node);

  // Non-item nodes (headers, buttons, menus, badges) carry no usable media id.
  const looksLikeMedia =
    isVideoId(id) || ALBUM_ID_RE.test(id) || CHANNEL_ID_RE.test(id) || /video|song|track|album|artist|playlist/i.test(rawType);
  if (!looksLikeMedia || (!title && !isVideoId(id))) return null;

  const duration =
    Number(node?.duration?.seconds ?? node?.duration_seconds ?? 0) ||
    durationTextToSeconds(node?.duration?.text ?? (typeof node?.duration === "string" ? node.duration : "")) ||
    Math.round(Number(node?.length_seconds ?? 0) / 1) ||
    0;

  return {
    id,
    itemType: rawType || (isVideoId(id) ? "song" : ALBUM_ID_RE.test(id) ? "album" : CHANNEL_ID_RE.test(id) ? "artist" : "unknown"),
    title: title || "Unknown Title",
    artist: artist || (isVideoId(id) ? "Unknown Artist" : ""),
    artistId,
    album: node?.album?.name ? readText(node.album.name) : undefined,
    albumId: typeof node?.album?.id === "string" ? node.album.id : undefined,
    durationSecs: Number.isFinite(duration) ? duration : 0,
    thumbnail: pickThumbnailUrl(node),
    year: typeof node?.year === "string" ? node.year : undefined,
  };
}

/** Container keys worth descending into, across InnerTube node types and raw JSON. */
const CONTAINER_KEYS = ["shelves", "contents", "results", "items", "sections", "tabs", "item"];

/** Merges a later sighting of the same id into the first one.
 *  YouTube repeats a track across shelves (top-result card, Songs, Videos) and the
 *  copies carry *different* amounts of metadata — the card shelf often omits the
 *  album. Keeping the first and enriching it beats "first wins". */
function mergeFlatItem(target: FlatItem, extra: FlatItem): void {
  if (!target.title || target.title === "Unknown Title") target.title = extra.title;
  if (!target.artist || target.artist === "Unknown Artist") target.artist = extra.artist;
  if (!target.artistId && extra.artistId) target.artistId = extra.artistId;
  if (!target.album && extra.album) target.album = extra.album;
  if (!target.albumId && extra.albumId) target.albumId = extra.albumId;
  if (!target.durationSecs && extra.durationSecs) target.durationSecs = extra.durationSecs;
  if (!target.thumbnail && extra.thumbnail) target.thumbnail = extra.thumbnail;
  if (!target.year && extra.year) target.year = extra.year;
  // Prefer a concrete item_type over the inferred "unknown".
  if (target.itemType === "unknown" && extra.itemType !== "unknown") target.itemType = extra.itemType;
}

/**
 * Recursively flattens any YouTube (Music) response into a de-duplicated item list.
 *
 * Accepts a parsed `Search` / `MusicShelf` / `Channel` / `Album` / `Artist`, a plain
 * array of nodes, or raw JSON. Depth-capped and cycle-safe.
 */
export function flattenShelves(input: any): FlatItem[] {
  if (!input) return [];

  const out: FlatItem[] = [];
  const byKey = new Map<string, FlatItem>();
  const visited = new WeakSet<object>();

  const visit = (node: any, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node !== "object" || visited.has(node)) return;
    visited.add(node);

    for (const key of CONTAINER_KEYS) {
      if (node[key] != null) visit(node[key], depth + 1);
    }

    const flat = toFlatItem(node);
    if (!flat) return;
    // A track and an album can share a title; the id is the real identity.
    const dedupeKey = `${flat.itemType}:${flat.id}`;
    const existing = byKey.get(dedupeKey);
    if (existing) {
      mergeFlatItem(existing, flat);
      return;
    }
    byKey.set(dedupeKey, flat);
    out.push(flat);
  };

  visit(input, 0);
  return out;
}

/* ------------------------------ typed mappers ------------------------------ */

/**
 * Songs/videos keep using `i.ytimg.com` artwork on purpose: the client already has
 * a `maxres -> sd -> hq -> mq -> default -> /icon.png` fallback chain and the
 * Media Session artwork list wired to those URLs.
 */
export function toTrack(item: FlatItem | null): Track | null {
  if (!item || !isVideoId(item.id)) return null;
  const thumbs = ytThumbs(item.id);
  return {
    id: item.id,
    videoId: item.id,
    title: item.title || "Unknown Title",
    artist: item.artist || "Unknown Artist",
    artistId: item.artistId,
    album: item.album,
    albumId: item.albumId,
    artwork: item.thumbnail && !/googleusercontent|ggpht/.test(item.thumbnail) ? item.thumbnail : thumbs.maxres,
    previewUrl: "",
    durationMs: Math.max(0, Math.round((item.durationSecs || 0) * 1000)),
    explicit: false,
    releaseDate: item.year,
  };
}

export function toAlbum(item: FlatItem | null): Album | null {
  if (!item) return null;
  const isRealAlbum = ALBUM_ID_RE.test(item.id);
  if (!isRealAlbum && !isVideoId(item.id)) return null;
  return {
    id: isRealAlbum ? item.id : encodePseudoAlbum({ q: item.title, t: item.title, a: item.artist }),
    title: item.title || "Unknown Album",
    artist: item.artist || "Unknown Artist",
    artistId: item.artistId,
    artwork: item.thumbnail || "",
    releaseDate: item.year,
  };
}

export function toArtist(item: FlatItem | null): Artist | null {
  if (!item) return null;
  const id = item.artistId || (CHANNEL_ID_RE.test(item.id) ? item.id : "");
  const name = item.artist || item.title;
  if (!id || !name) return null;
  return { id, name, artwork: item.thumbnail || "" };
}

/* ------------------------------ classification ------------------------------ */

export interface ClassifiedItems {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

/**
 * Splits a flattened list into the three buckets the UI expects.
 * Anything with an 11-char video id is playable, so those become tracks;
 * `MPR…`/`OLAK5uy…` become albums and `UC…` become artists.
 *
 * Two passes on purpose: real Album/Artist shelves carry proper square artwork and
 * canonical names, so they must claim the id *before* we backfill artists from song
 * rows (whose only artwork is a 16:9 video thumbnail).
 */
export function classifyItems(items: FlatItem[], limit = 30): ClassifiedItems {
  const tracks: Track[] = [];
  const albums: Album[] = [];
  const artists: Artist[] = [];
  const seenAlbum = new Set<string>();
  const seenArtist = new Set<string>();
  const seenTrack = new Set<string>();

  /* ---- pass 1: real albums and artists ---- */
  for (const item of items) {
    if (isVideoId(item.id)) continue;

    if (ALBUM_ID_RE.test(item.id)) {
      if (albums.length < limit && !seenAlbum.has(item.id)) {
        const a = toAlbum(item);
        if (a) {
          seenAlbum.add(item.id);
          albums.push(a);
        }
      }
      continue;
    }

    if (CHANNEL_ID_RE.test(item.id)) {
      const art = toArtist(item);
      if (art && artists.length < limit && !seenArtist.has(art.id)) {
        seenArtist.add(art.id);
        artists.push(art);
      }
    }
  }

  /* ---- pass 2: playable tracks (+ artist backfill) ---- */
  for (const item of items) {
    if (!isVideoId(item.id)) continue;
    // The same recording shows up as both a "song" (ATV) and a "video" (UGC/OMV).
    if (seenTrack.has(item.id)) continue;

    const t = toTrack(item);
    if (!t) continue;
    seenTrack.add(item.id);
    if (tracks.length < limit) tracks.push(t);

    if (item.artistId && item.artist && !seenArtist.has(item.artistId)) {
      seenArtist.add(item.artistId);
      if (artists.length < limit) {
        artists.push({ id: item.artistId, name: item.artist, artwork: ytThumbs(item.id).maxres });
      }
    }
  }

  return { tracks, albums, artists };
}

/**
 * Guarantees non-empty album/artist buckets by deriving them from the tracks,
 * which mirrors the previous behaviour and keeps every screen populated even
 * when YouTube returns only a song shelf.
 */
export function backfillFromTracks(tracks: Track[], albums: Album[], artists: Artist[]): ClassifiedItems {
  const seenAlbum = new Set(albums.map((a) => a.title));
  const seenArtist = new Set(artists.map((a) => a.id));

  for (const t of tracks) {
    if (albums.length < 6 && t.title && !seenAlbum.has(t.title)) {
      seenAlbum.add(t.title);
      albums.push({
        id: encodePseudoAlbum({ q: t.title, t: t.title, a: t.artist }),
        title: t.title,
        artist: t.artist,
        artistId: t.artistId,
        artwork: t.artwork,
      });
    }
    if (artists.length < 6 && t.artistId && t.artist && !seenArtist.has(t.artistId)) {
      seenArtist.add(t.artistId);
      artists.push({ id: t.artistId, name: t.artist, artwork: t.artwork });
    }
  }

  return { tracks, albums, artists };
}

/* ------------------------------ pseudo albums ------------------------------ */

export interface PseudoAlbum {
  q: string;
  t: string;
  a: string;
}

export function encodePseudoAlbum(p: PseudoAlbum): string {
  return `ytq-${Buffer.from(JSON.stringify(p), "utf8").toString("base64url")}`;
}

export function decodePseudoAlbum(id: string): PseudoAlbum | null {
  if (!id?.startsWith("ytq-")) return null;
  try {
    const d = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8"));
    if (typeof d?.q === "string" && typeof d?.t === "string") return { q: d.q, t: d.t, a: String(d?.a ?? "") };
  } catch {
    /* invalid */
  }
  return null;
}

export const isPseudoAlbumId = (id: string) => id?.startsWith("ytq-");
