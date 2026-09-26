export interface LyricsQuery {
  title: string;
  artist?: string;
  duration?: number;
}
export interface LyricsResult {
  /** Plain, copy-friendly lyrics. Always present (may be "" for instrumentals). */
  lyrics: string;
  source: "LRCLIB" | "lyrics.ovh";
  instrumental?: boolean;
  /**
   * Time-stamped lines parsed from the provider's LRC payload, sorted by start time.
   * Empty when the provider only had plain lyrics — the UI then stays in static mode.
   */
  lines: LyricLine[];
}

/** One time-stamped line of a song (LRC gives line-level timing, not word-level). */
export interface LyricLine {
  /** Milliseconds from the start of the track, already corrected for any `[offset:]` tag. */
  startMs: number;
  text: string;
}

export function cleanTitle(value: string): string {
  return value
    .replace(/\[[^\]]*(?:official|video|audio|lyrics?|visualizer|hd|remaster)[^\]]*\]/gi, " ")
    .replace(/\([^)]*(?:official|video|audio|lyrics?|visualizer|remaster|version|feat\.?)[^)]*\)/gi, " ")
    .replace(/\b(?:official\s+)?(?:music\s+)?(?:video|audio)\b/gi, " ")
    .replace(/\b(?:lyrics?|visualizer|4k|8k|hd|hq)\b/gi, " ")
    .replace(/\s*[-–—|]+\s*$/g, "")
    .replace(/\s+/g, " ").trim();
}
const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function queryVariants({ title, artist = "" }: LyricsQuery): LyricsQuery[] {
  title = cleanTitle(title);
  artist = artist.replace(/\s*[-–—]\s*Topic\s*$/i, "").replace(/VEVO$/i, "").trim();
  if (/^(unknown artist|various artists)$/i.test(artist)) artist = "";
  const variants: LyricsQuery[] = [{ title, artist }];
  // Video titles often contain artist - song | film / credits; the channel is not necessarily the singer.
  const first = title.split(/\s*[|]\s*|\s+[–—]\s+/)[0].trim();
  const dash = first.split(/\s+-\s+/);
  if (dash.length > 1) {
    variants.push({ title: dash[1], artist: dash[0] });
    variants.push({ title: dash[0], artist });
  } else if (first !== title) variants.push({ title: first, artist });
  const withoutFilm = first.replace(/\s*\(from\s+[^)]*\)/gi, "").trim();
  if (withoutFilm !== first) variants.push({ title: withoutFilm, artist });
  return variants.filter((q, i, all) => q.title && all.findIndex((v) => v.title === q.title && v.artist === q.artist) === i).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/*  LRC (timestamped lyrics) parsing.                                  */
/*                                                                     */
/*  LRCLIB ships `syncedLyrics` as an LRC document:                    */
/*    [00:12.43]First line                                             */
/*    [00:16.10][01:02.80]Chorus repeats share timestamps              */
/*    [offset:+500] / [ar:..] / [ti:..] metadata tags                   */
/*  Some community submissions use the "enhanced" A2 flavour with      */
/*  inline word markers ([00:12.43]<00:12.43>word<00:12.90>word), so    */
/*  those markers are stripped — this build syncs line by line.        */
/* ------------------------------------------------------------------ */

/** Every `[mm:ss.xx]` stamp in front of a line, captured with the text that follows. */
const LRC_LINE = /((?:\[\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?\])+)(.*)/;
const LRC_STAMP = /\[(\d{1,3}):(\d{1,3})(?:[.:](\d{1,3}))?\]/g;
/** Metadata tags such as `[ar:Artist]`, `[ti:Title]`, `[offset:+500]`. */
const LRC_META = /^\[(ar|ti|al|au|by|offset|re|ve|length|hash|sign|qq|total|tool|language|karaoke)\s*:/i;
/** Inline word markers of the enhanced LRC format: `<00:12.43>`. */
const LRC_WORD_MARK = /<\d{1,3}:\d{1,3}(?:[.:]\d{1,3})?>/g;

function toMillis(minutes: string, seconds: string, fraction?: string): number {
  // "[00:12.4]" means tenths, "[00:12.43]" hundredths, "[00:12.435]" millis.
  const scale = !fraction ? 1000 : fraction.length === 1 ? 100 : fraction.length === 2 ? 10 : 1;
  return Math.round(Number(minutes) * 60000 + Number(seconds) * 1000 + Number(fraction || 0) * scale);
}

/**
 * Parse an LRC document into time-ordered lines.
 * Returns `[]` for anything that carries no usable timestamps.
 */
export function parseLrc(lrc?: string | null): LyricLine[] {
  if (!lrc) return [];
  let offsetMs = 0;
  const out: LyricLine[] = [];

  for (const raw of lrc.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;

    const meta = /^\[\s*offset\s*:\s*([+-]?\d+)\s*\]/i.exec(line);
    if (meta) {
      // Positive offset shifts lyrics later; negative pulls them earlier.
      offsetMs = Number(meta[1]);
      continue;
    }
    if (LRC_META.test(line)) continue;

    const match = LRC_LINE.exec(line);
    if (!match) continue;

    const text = match[2].replace(LRC_WORD_MARK, " ").replace(/\s+/g, " ").trim();
    if (!text) continue; // instrumental breaks / repeated "[00:20.00]" markers

    LRC_STAMP.lastIndex = 0;
    let stamp: RegExpExecArray | null;
    while ((stamp = LRC_STAMP.exec(match[1]))) {
      const startMs = Math.max(0, toMillis(stamp[1], stamp[2], stamp[3]) + offsetMs);
      out.push({ startMs, text });
    }
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}

/** True when a parsed LRC payload is actually usable for karaoke-style highlighting. */
export function usableSync(lines: LyricLine[]): boolean {
  // A single stamp (or none) usually means the provider only marked the intro.
  return lines.length >= 2 && lines.some((l) => l.startMs > 0);
}

/** Plain text of the timed lines, used when the provider sent only `syncedLyrics`. */
export function linesToText(lines: LyricLine[]): string {
  return lines.map((l) => l.text).join("\n");
}

/**
 * Index of the line that should be lit up at `positionMs`, or -1 before the first
 * line starts. Binary search: the array is sorted and songs can have 100+ lines.
 */
export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  if (!lines.length || positionMs < lines[0].startMs) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].startMs <= positionMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface LrcRecord {
  trackName: string;
  artistName: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: string;
  instrumental?: boolean;
}
function toResult(record: LrcRecord): LyricsResult | null {
  // Prefer the timed payload: it carries the same words *plus* per-line timestamps,
  // so the player can offer a synced view while static text stays available.
  const lines = parseLrc(record.syncedLyrics);
  const synced = usableSync(lines);
  const plain = record.plainLyrics?.trim();

  if (synced) return { lyrics: plain || linesToText(lines), lines, source: "LRCLIB" };
  if (plain) return { lyrics: plain, lines: [], source: "LRCLIB" };
  if (lines.length) return { lyrics: linesToText(lines), lines: [], source: "LRCLIB" };
  if (record.instrumental) return { lyrics: "", lines: [], instrumental: true, source: "LRCLIB" };
  return null;
}

export class LyricsUnavailableError extends Error {}

/**
 * Provider roots, read lazily so this module stays server-only (no env values get
 * inlined into a client bundle). Overridable for local testing/mirrors —
 * production always uses the public endpoints because nothing must be configured.
 */
export function providerBase(kind: "lrclib" | "lyricsOvh"): string {
  const override = kind === "lrclib" ? process.env.LRCLIB_BASE : process.env.LYRICS_OVH_BASE;
  const fallback = kind === "lrclib" ? "https://lrclib.net" : "https://api.lyrics.ovh";
  return (override || fallback).replace(/\/+$/, "");
}

/** Bounded API requests, no HTML scraping. Missing songs and provider failures stay distinct. */
export async function findLyrics(query: LyricsQuery, fetcher: typeof fetch = fetch): Promise<LyricsResult | null> {
  const variants = queryVariants(query);
  let failed = false;
  async function json(url: string): Promise<unknown> {
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(4000),
        headers: { Accept: "application/json", "User-Agent": "Sidify-V2/1.0" },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Lyrics provider HTTP ${response.status}`);
      return await response.json();
    } catch {
      failed = true;
      return null;
    }
  }
  const exact = await Promise.all(variants.map(async (v) => {
    const params = new URLSearchParams({ track_name: v.title, artist_name: v.artist || "" });
    if (query.duration) params.set("duration", String(query.duration));
    const record = await json(`${providerBase("lrclib")}/api/get?${params}`) as LrcRecord | null;
    return record ? toResult(record) : null;
  }));
  const hit = exact.find(Boolean);
  if (hit) return hit;

  // Title-only search also works when YouTube supplies a label/channel as artist.
  const searches = await Promise.all(variants.map(async (v) => {
    const records = await json(`${providerBase("lrclib")}/api/search?${new URLSearchParams({ track_name: v.title })}`);
    if (!Array.isArray(records)) return [];
    return (records as LrcRecord[]).flatMap((record) => {
      if (typeof record.trackName !== "string" || typeof record.artistName !== "string") return [];
      if (normalized(cleanTitle(record.trackName)) !== normalized(v.title)) return [];
      const artistMatch = !!v.artist && normalized(record.artistName).includes(normalized(v.artist));
      const durationMatch = !!query.duration && typeof record.duration === "number" && Math.abs(record.duration - query.duration) <= 5;
      const result = toResult(record);
      return result ? [{ result, score: (artistMatch ? 4 : 0) + (durationMatch ? 2 : 0), identity: normalized(record.artistName) }] : [];
    });
  }));
  const ranked = searches.flat().sort((a, b) => b.score - a.score);
  // Do not pick a random artist's song when several songs share the same name.
  if (ranked.length && (ranked[0].score > 0 || new Set(ranked.map((r) => r.identity)).size === 1)) return ranked[0].result;

  const fallback = await Promise.all(variants.filter((v) => v.artist).map(async (v) => {
    const data = await json(`${providerBase("lyricsOvh")}/v1/${encodeURIComponent(v.artist!)}/${encodeURIComponent(v.title)}`) as { lyrics?: string } | null;
    return typeof data?.lyrics === "string" && data.lyrics.trim() ? { lyrics: data.lyrics.trim(), lines: [], source: "lyrics.ovh" as const } : null;
  }));
  const result = fallback.find(Boolean);
  if (result) return result;
  if (failed) throw new LyricsUnavailableError("Lyrics services are temporarily unavailable. Please retry.");
  return null;
}
