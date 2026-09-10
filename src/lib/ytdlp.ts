/**
 * Server-side YouTube engine for Sidify.
 * - Search via yt-dlp `ytsearch{limit}:{query}` (flat extraction).
 * - Channel/artist videos via yt-dlp channel tab extraction.
 * - Audio stream resolution chain: yt-dlp (multiple player clients) -> youtubei.js.
 * All results cached in-memory with TTL + in-flight dedupe. Never exposed to client.
 */
import { execFile } from "node:child_process";
import { accessSync } from "node:fs";
import type { Track } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = (v: string) => VIDEO_ID_RE.test(v);

const YTDLP_CANDIDATES = [
  process.env.YTDLP_PATH,
  "/app/bin/yt-dlp",
  "yt-dlp",
].filter(Boolean) as string[];

let ytdlpPath: string | null = null;
function findYtDlp(): string {
  if (ytdlpPath) return ytdlpPath;
  for (const p of YTDLP_CANDIDATES) {
    try {
      accessSync(p);
      ytdlpPath = p;
      return p;
    } catch {
      /* next */
    }
  }
  ytdlpPath = "/app/bin/yt-dlp";
  return ytdlpPath;
}

function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      findYtDlp(),
      ["--no-warnings", "--skip-download", ...args],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message || "yt-dlp failed").slice(0, 300)));
        } else {
          resolve(stdout);
        }
      }
    );
    child.on("error", reject);
  });
}

/* ------------------------------ caching ------------------------------ */
interface CacheEntry<T> { at: number; data: T }
const searchCache = new Map<string, CacheEntry<any[]>>();
const channelCache = new Map<string, CacheEntry<any>>();
const audioCache = new Map<string, CacheEntry<ResolvedAudio | null>>();
const inflight = new Map<string, Promise<any>>();

const SEARCH_TTL = 10 * 60_000;
const CHANNEL_TTL = 30 * 60_000;
const AUDIO_TTL = 90 * 60_000;
const AUDIO_NEG_TTL = 60_000;

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ------------------------------ helpers ------------------------------ */
export function ytThumbs(videoId: string) {
  return {
    maxres: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    hq: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    mq: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    def: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
  };
}

function pickThumb(e: any, videoId: string): string {
  const ths: any[] = Array.isArray(e?.thumbnails) ? e.thumbnails : [];
  let best = "";
  let bestW = 0;
  for (const t of ths) {
    const url = typeof t === "string" ? t : t?.url;
    const w = (typeof t === "object" && (t?.width || t?.preference)) || 0;
    if (url && w >= bestW && !url.endsWith(".webp")) {
      best = url;
      bestW = w;
    }
  }
  return best || ytThumbs(videoId).hq;
}

export function toTrack(e: any): Track | null {
  const id = e?.id || e?.url?.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
  if (!id || !isVideoId(String(id))) return null;
  const vid = String(id);
  const t = ytThumbs(vid);
  return {
    id: vid,
    videoId: vid,
    title: String(e?.title ?? "Unknown title"),
    artist: String(e?.channel ?? e?.uploader ?? e?.channel_name ?? "Unknown Artist"),
    artistId: e?.channel_id || e?.uploader_id || undefined,
    artwork: pickThumb(e, vid),
    previewUrl: "",
    durationMs: Math.round(Number(e?.duration ?? 0) * 1000) || 0,
    explicit: false,
  };
}

/* ------------------------------ yt-dlp search ------------------------------ */
export async function ytSearch(query: string, limit: number): Promise<any[]> {
  const key = `s:${query.toLowerCase()}:${limit}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.data;

  return dedupe(key, async () => {
    const safeQ = query.replace(/[\x00-\x1f]/g, " ").slice(0, 120);
    const out = await runYtDlp(
      [`ytsearch${Math.min(Math.max(limit, 1), 30)}:${safeQ}`, "--flat-playlist", "--dump-json"],
      30_000
    );
    const items: any[] = [];
    for (const line of out.split("\n")) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const e = JSON.parse(l);
        if (e?.id && isVideoId(String(e.id))) items.push(e);
      } catch {
        /* skip bad line */
      }
    }
    searchCache.set(key, { at: Date.now(), data: items });
    return items;
  });
}

export async function ytSearchTracks(query: string, limit: number): Promise<Track[]> {
  try {
    const entries = await ytSearch(query, limit);
    return entries.map(toTrack).filter(Boolean) as Track[];
  } catch (e) {
    console.error("ytSearch error", (e as Error).message);
    return [];
  }
}

/* ------------------------------ channel / artist ------------------------------ */
export interface ChannelData {
  name: string;
  channelId?: string;
  entries: any[];
}

export async function ytChannelVideos(channelIdOrName: string, limit = 20): Promise<ChannelData | null> {
  const key = `c:${channelIdOrName.toLowerCase()}:${limit}`;
  const hit = channelCache.get(key);
  if (hit && Date.now() - hit.at < CHANNEL_TTL) return hit.data as ChannelData;

  return dedupe(key, async () => {
    let result: ChannelData | null = null;
    const looksLikeId = /^UC[A-Za-z0-9_-]{10,}$/.test(channelIdOrName) || channelIdOrName.startsWith("@");
    if (looksLikeId) {
      const url = channelIdOrName.startsWith("@")
        ? `https://www.youtube.com/${channelIdOrName}/videos`
        : `https://www.youtube.com/channel/${channelIdOrName}/videos`;
      try {
        const out = await runYtDlp([url, "-J", "--flat-playlist", `--playlist-items`, `1-${limit}`], 40_000);
        const d = JSON.parse(out);
        const entries = (d?.entries || []).filter((e: any) => e?.id && isVideoId(String(e.id)));
        result = {
          name: String(d?.channel || d?.uploader || d?.title || "Artist"),
          channelId: channelIdOrName.startsWith("@") ? undefined : channelIdOrName,
          entries,
        };
      } catch (e) {
        console.error("channel extract failed", (e as Error).message);
      }
    }
    if (!result || !result.entries.length) {
      // Fallback: plain search by name
      const entries = await ytSearch(channelIdOrName, limit).catch(() => [] as any[]);
      if (entries.length) {
        result = {
          name: String(entries[0]?.channel || channelIdOrName),
          channelId: entries[0]?.channel_id,
          entries,
        };
      }
    }
    if (result) channelCache.set(key, { at: Date.now(), data: result });
    return result;
  });
}

/* ------------------------------ pseudo albums ------------------------------ */
export interface PseudoAlbum { q: string; t: string; a: string }
export function encodePseudoAlbum(p: PseudoAlbum): string {
  return `ytq-${Buffer.from(JSON.stringify(p), "utf8").toString("base64url")}`;
}
export function decodePseudoAlbum(id: string): PseudoAlbum | null {
  if (!id.startsWith("ytq-")) return null;
  try {
    const d = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8"));
    if (typeof d?.q === "string" && typeof d?.t === "string") return { q: d.q, t: d.t, a: String(d?.a ?? "") };
  } catch { /* invalid */ }
  return null;
}

/* ------------------------------ audio resolution ------------------------------ */
export interface ResolvedAudio {
  url: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

async function resolveViaYtDlp(videoId: string, client: string): Promise<ResolvedAudio | null> {
  try {
    const out = await runYtDlp(
      [
        `https://www.youtube.com/watch?v=${videoId}`,
        "--dump-single-json",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "--extractor-args",
        `youtube:player_client=${client}`,
      ],
      35_000
    );
    const d = JSON.parse(out);
    let url = d?.url as string | undefined;
    if (!url && Array.isArray(d?.formats)) {
      const aud = d.formats
        .filter((f: any) => f?.acodec && f.acodec !== "none" && (!f?.vcodec || f.vcodec === "none") && f?.url)
        .sort((a: any, b: any) => (b?.abr ?? b?.tbr ?? 0) - (a?.abr ?? a?.tbr ?? 0));
      url = aud[0]?.url;
    }
    if (!url) return null;
    return {
      url,
      title: String(d?.title ?? ""),
      artist: String(d?.channel ?? d?.uploader ?? ""),
      duration: Number(d?.duration ?? 0),
      thumbnail: String(d?.thumbnail ?? ytThumbs(videoId).hq),
    };
  } catch {
    return null;
  }
}

async function resolveViaYoutubei(videoId: string): Promise<ResolvedAudio | null> {
  try {
    const mod = await import("youtubei.js");
    const yt = await mod.Innertube.create({ client_type: "ANDROID" as never, generate_session_locally: true });
    const info = await yt.getBasicInfo(videoId);
    const fmts = (info.streaming_data?.adaptive_formats || [])
      .filter((f: any) => f?.mime_type?.startsWith("audio") && f?.url)
      .sort((a: any, b: any) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
    const best = fmts[0] as any;
    if (!best?.url) return null;
    return {
      url: String(best.url),
      title: info.basic_info.title ?? "",
      artist: info.basic_info.author ?? "",
      duration: info.basic_info.duration ?? 0,
      thumbnail: ytThumbs(videoId).hq,
    };
  } catch {
    return null;
  }
}

export async function resolveAudio(videoId: string, skipCache = false): Promise<ResolvedAudio | null> {
  const key = `a:${videoId}`;
  if (!skipCache) {
    const hit = audioCache.get(key);
    if (hit) {
      const ttl = hit.data ? AUDIO_TTL : AUDIO_NEG_TTL;
      if (Date.now() - hit.at < ttl) return hit.data;
    }
  }

  return dedupe(key, async () => {
    for (const client of ["web", "android", "tv_embedded"]) {
      const r = await resolveViaYtDlp(videoId, client);
      if (r?.url) {
        audioCache.set(key, { at: Date.now(), data: r });
        return r;
      }
    }
    const yi = await resolveViaYoutubei(videoId);
    if (yi?.url) {
      audioCache.set(key, { at: Date.now(), data: yi });
      return yi;
    }
    audioCache.set(key, { at: Date.now(), data: null });
    return null;
  });
}
