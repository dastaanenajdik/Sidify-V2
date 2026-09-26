export interface LyricsQuery {
  title: string;
  artist?: string;
  duration?: number;
}
export interface LyricsResult {
  lyrics: string;
  source: "LRCLIB" | "lyrics.ovh";
  instrumental?: boolean;
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

interface LrcRecord {
  trackName: string;
  artistName: string;
  duration?: number;
  plainLyrics?: string;
  syncedLyrics?: string;
  instrumental?: boolean;
}
function toResult(record: LrcRecord): LyricsResult | null {
  const lyrics = record.plainLyrics?.trim() || record.syncedLyrics?.replace(/\[\d+:\d+(?:\.\d+)?\]/g, "").trim();
  if (lyrics) return { lyrics, source: "LRCLIB" };
  if (record.instrumental) return { lyrics: "", instrumental: true, source: "LRCLIB" };
  return null;
}

export class LyricsUnavailableError extends Error {}

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
    const record = await json(`https://lrclib.net/api/get?${params}`) as LrcRecord | null;
    return record ? toResult(record) : null;
  }));
  const hit = exact.find(Boolean);
  if (hit) return hit;

  // Title-only search also works when YouTube supplies a label/channel as artist.
  const searches = await Promise.all(variants.map(async (v) => {
    const records = await json(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: v.title })}`);
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
    const data = await json(`https://api.lyrics.ovh/v1/${encodeURIComponent(v.artist!)}/${encodeURIComponent(v.title)}`) as { lyrics?: string } | null;
    return typeof data?.lyrics === "string" && data.lyrics.trim() ? { lyrics: data.lyrics.trim(), source: "lyrics.ovh" as const } : null;
  }));
  const result = fallback.find(Boolean);
  if (result) return result;
  if (failed) throw new LyricsUnavailableError("Lyrics services are temporarily unavailable. Please retry.");
  return null;
}
