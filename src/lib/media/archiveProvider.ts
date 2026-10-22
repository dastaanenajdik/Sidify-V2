/**
 * Internet Archive provider — free, lawful films that actually stream.
 *
 * Sources are archive.org's own catalogue endpoints:
 *   • /advancedsearch.php  — search, filters and pagination
 *   • /metadata/<id>       — file list for direct downloads
 *   • /embed/<id>          — the archive's official player (works for every item,
 *                            and is immune to derivative files being renamed)
 *
 * Only the openly available film collections in `MOVIE_COLLECTIONS` are queried, so the
 * shelf only ever offers public-domain / openly licensed material. If archive.org cannot
 * be reached (offline sandbox, archive outage) the provider serves `ARCHIVE_SNAPSHOT`
 * instead of failing, which keeps the page usable and honest — the snapshot holds real
 * identifiers that still play in the browser.
 *
 * Series are not served from the archive yet: the collection mixes serials and
 * anthologies without reliable season/episode metadata, so `series` returns nothing and
 * the router falls back to the metadata provider.
 */

import { MediaProviderError, type MediaProvider } from "./provider";
import { buildFacets, queryTitles, relatedTitles } from "./query";
import type {
  Genre,
  MediaDetail,
  MediaDownload,
  MediaFacets,
  MediaKind,
  MediaPage,
  MediaQuery,
  MediaTitle,
  PlaybackSource,
  ProviderInfo,
  Season,
} from "./types";
import {
  ARCHIVE_LANGUAGES,
  ARCHIVE_META_URL,
  ARCHIVE_SEARCH_URL,
  ARCHIVE_SNAPSHOT,
  archiveDocToTitle,
  archiveDownloadUrl,
  archiveGenreList,
  archiveIdentifier,
  archiveMatchQuery,
  archiveMatchScore,
  archiveOverview,
  archivePlaybackSources,
  archivePosterUrl,
  archiveSearchParams,
  archiveSlug,
  archiveSnapshotTitles,
  buildArchiveQuery,
  type ArchiveDoc,
  type ArchiveSearchResponse,
} from "./archive";

export const ARCHIVE_PROVIDER_INFO: ProviderInfo = {
  id: "archive",
  label: "Internet Archive",
  attribution:
    "Free films stream from the Internet Archive (archive.org) — public-domain and openly licensed titles. Rights and availability can vary by item.",
  demo: false,
};

const PAGE_SIZE = 24;
const REQUEST_TIMEOUT_MS = 7_000;

/** Archive identifiers are safe for URLs, but never interpolate raw strings blindly. */
const identifierPath = (identifier: string) => encodeURIComponent(identifier);

interface ArchiveMetadata {
  is_dark?: boolean;
  metadata?: ArchiveDoc;
  files?: { name?: string; format?: string; size?: string; source?: string }[];
}

async function archiveJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "Sidify/1.0 (movie catalogue)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Metadata changes slowly; let the Next data cache serve repeat visits.
      next: { revalidate },
    });
    if (!res.ok) {
      console.warn(`[media/archive] ${res.status} for ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`[media/archive] request failed for ${url}:`, (error as Error)?.message);
    return null;
  }
}

interface SearchResult {
  docs: ArchiveDoc[];
  total: number;
}

async function searchDocs(q: string, page: number, rows: number, sort: string, revalidate = 900): Promise<SearchResult | null> {
  const url = `${ARCHIVE_SEARCH_URL}?${archiveSearchParams(q, page, rows, sort).toString()}`;
  const data = await archiveJson<ArchiveSearchResponse>(url, revalidate);
  const docs = data?.response?.docs;
  if (!Array.isArray(docs)) return null;
  return { docs, total: Math.max(0, data?.response?.numFound ?? docs.length) };
}

function mapDocs(docs: ArchiveDoc[]): MediaTitle[] {
  const seen = new Set<string>();
  const out: MediaTitle[] = [];
  for (const doc of docs) {
    const title = archiveDocToTitle(doc);
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    out.push(title);
  }
  return out;
}

/** Snapshot search — the offline path. Same semantics as the live API. */
function snapshotPage(query: MediaQuery): MediaPage {
  return queryTitles(archiveSnapshotTitles(), query, PAGE_SIZE);
}

/** Download links: the archive's download page plus any direct video file it lists. */
export async function archiveDownloads(identifier: string): Promise<MediaDownload[]> {
  const downloads: MediaDownload[] = [
    { label: "All download options", url: archiveDownloadUrl(identifier), kind: "page" },
  ];
  const meta = await archiveJson<ArchiveMetadata>(`${ARCHIVE_META_URL}/${identifierPath(identifier)}`, 86_400);
  if (!meta || meta.is_dark || !Array.isArray(meta.files)) return downloads;

  const videos = meta.files
    .filter((file) => typeof file.name === "string" && /\.(mp4|m4v|webm|ogv)$/i.test(file.name))
    .map((file) => ({
      name: file.name as string,
      format: file.format || (/\.mp4$/i.test(file.name as string) ? "MPEG4" : "Video"),
      size: Number(file.size) || 0,
    }))
    .sort((a, b) => Number(/MPEG4|h\.?264/i.test(b.format)) - Number(/MPEG4|h\.?264/i.test(a.format)) || b.size - a.size)
    .slice(0, 3);

  for (const file of videos) {
    downloads.push({
      label: file.format.toUpperCase(),
      url: `${archiveDownloadUrl(identifier)}/${encodeURIComponent(file.name).replace(/%2F/gi, "/")}`,
      kind: "file",
      format: file.format,
      sizeBytes: file.size || undefined,
    });
  }
  return downloads;
}

export class ArchiveMediaProvider implements MediaProvider {
  readonly info = ARCHIVE_PROVIDER_INFO;

  private snapshot(): MediaTitle[] {
    return archiveSnapshotTitles();
  }

  /* _____________________________ discovery _____________________________ */

  async getFreeToWatch(limit = 20): Promise<MediaTitle[]> {
    const spec = buildArchiveQuery({ sort: "trending" });
    const live = await searchDocs(spec.q, 1, Math.max(1, limit), spec.sort);
    const items = live ? mapDocs(live.docs) : [];
    return (items.length ? items : this.snapshot()).slice(0, limit);
  }

  async getTrendingMovies(limit = 20): Promise<MediaTitle[]> {
    return this.getFreeToWatch(limit);
  }
  async getPopularMovies(limit = 20): Promise<MediaTitle[]> {
    const spec = buildArchiveQuery({ sort: "trending" });
    const live = await searchDocs(spec.q, 1, Math.max(1, limit), spec.sort);
    return (live ? mapDocs(live.docs) : this.snapshot()).slice(0, limit);
  }
  async getNewMovieReleases(limit = 20): Promise<MediaTitle[]> {
    const spec = buildArchiveQuery({ sort: "newest" });
    const live = await searchDocs(spec.q, 1, Math.max(1, limit), spec.sort);
    return (live ? mapDocs(live.docs) : this.snapshot()).slice(0, limit);
  }
  async getTopRatedMovies(limit = 20): Promise<MediaTitle[]> {
    const spec = buildArchiveQuery({ sort: "rating" });
    const live = await searchDocs(spec.q, 1, Math.max(1, limit), spec.sort);
    return (live ? mapDocs(live.docs) : this.snapshot()).slice(0, limit);
  }

  /** The archive isn't used for series (see the module comment). */
  async getTrendingSeries(): Promise<MediaTitle[]> {
    return [];
  }
  async getPopularSeries(): Promise<MediaTitle[]> {
    return [];
  }
  async getNewSeriesReleases(): Promise<MediaTitle[]> {
    return [];
  }
  async getTopRatedSeries(): Promise<MediaTitle[]> {
    return [];
  }

  /* ______________________________ browsing _____________________________ */

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    if (kind === "series") {
      return { items: [], page: 1, totalPages: 1, totalResults: 0, pageSize: PAGE_SIZE };
    }
    const page = Math.max(1, Math.floor(query.page || 1));
    const spec = buildArchiveQuery(query);
    const live = await searchDocs(spec.q, page, PAGE_SIZE, spec.sort);

    if (live) {
      const items = mapDocs(live.docs);
      return {
        items,
        page,
        totalPages: Math.max(1, Math.min(Math.ceil(live.total / PAGE_SIZE), 10_000 / PAGE_SIZE)),
        totalResults: live.total,
        pageSize: PAGE_SIZE,
      };
    }

    // Archive unreachable → snapshot so the shelf is never empty, but say so.
    return snapshotPage({ ...query, page });
  }

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 20): Promise<MediaTitle[]> {
    if (kind === "series") return [];
    const term = query.trim();
    if (!term) return [];
    const spec = buildArchiveQuery({ q: term, sort: "trending" });
    const live = await searchDocs(spec.q, 1, Math.max(1, Math.min(limit * 2, 80)), spec.sort);
    const items = live ? mapDocs(live.docs) : queryTitles(this.snapshot(), { q: term }, limit).items;
    return items.slice(0, limit);
  }

  async getGenres(): Promise<Genre[]> {
    return archiveGenreList();
  }

  async getFacets(kind: MediaKind): Promise<MediaFacets> {
    if (kind === "series") return buildFacets([]);
    const snapshotFacets = buildFacets(this.snapshot());
    const current = new Date().getFullYear();
    const decades: string[] = [];
    for (let start = Math.floor(current / 10) * 10; start >= 1920; start -= 10) decades.push(`${start}s`);
    const years = [...new Set([...snapshotFacets.years, ...decades])];
    return {
      genres: archiveGenreList(),
      years,
      languages: ARCHIVE_LANGUAGES,
    };
  }

  /* ______________________________ details ______________________________ */

  private async findDoc(identifier: string): Promise<ArchiveDoc | null> {
    const seeded = ARCHIVE_SNAPSHOT.find((doc) => doc.identifier === identifier);
    if (seeded) return seeded;
    const result = await searchDocs(`identifier:"${identifier.replace(/"/g, "")}"`, 1, 1, "downloads desc", 86_400);
    return result?.docs?.[0] ?? null;
  }

  async getMovieDetails(slug: string): Promise<MediaDetail | null> {
    const identifier = archiveIdentifier(slug);
    if (!identifier) return null;

    // No entry in the snapshot and the API did not answer → this is not a real item,
    // so the route 404s instead of rendering an empty page around a broken player.
    const doc = await this.findDoc(identifier);
    if (!doc) return null;
    const title = archiveDocToTitle(doc);
    if (!title) return null;

    if (doc.description) title.overview = archiveOverview(doc);

    const [related, downloads, meta] = await Promise.all([
      this.relatedFor(title),
      archiveDownloads(identifier),
      archiveJson<ArchiveMetadata>(`${ARCHIVE_META_URL}/${identifierPath(identifier)}`, 86_400),
    ]);

    // A dark (removed/pulled) item has no files: keep the page honest, no player.
    const dark = Boolean(meta?.is_dark);
    const playback: PlaybackSource[] = dark ? [] : archivePlaybackSources(identifier);

    if (dark) {
      title.overview = title.overview || "This item is no longer publicly available on the Internet Archive.";
    }

    return {
      title,
      seasons: [],
      related,
      playback,
      downloads: dark ? downloads.filter((entry) => entry.kind === "page") : downloads,
      provider: this.info,
      attribution: this.info.attribution,
    };
  }

  private async relatedFor(title: MediaTitle): Promise<MediaTitle[]> {
    const genre = title.genres[0]?.name;
    if (!genre) {
      const local = relatedTitles(this.snapshot(), title, 12);
      return local.length ? local : this.snapshot().filter((item) => item.id !== title.id).slice(0, 12);
    }
    const live = await searchDocs(buildArchiveQuery({ genre: title.genres[0].id }).q, 1, 20, "downloads desc", 3600);
    const items = (live ? mapDocs(live.docs) : []).filter((item) => item.id !== title.id);
    if (items.length >= 4) return items.slice(0, 12);
    const local = relatedTitles(this.snapshot(), title, 12).filter((item) => item.id !== title.id);
    const merged = [...items, ...local];
    const seen = new Set<string>();
    return merged.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))).slice(0, 12);
  }

  async getSeriesDetails(): Promise<MediaDetail | null> {
    return null;
  }

  async getSeriesSeasons(): Promise<Season[]> {
    return [];
  }

  async getRelated(kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    if (kind !== "movie") return [];
    const identifier = archiveIdentifier(slug);
    if (!identifier) return [];
    const doc = await this.findDoc(identifier);
    if (!doc) return [];
    const title = archiveDocToTitle(doc);
    if (!title) return [];
    return (await this.relatedFor(title)).slice(0, limit);
  }

  /* ______________________________ playback _____________________________ */

  async getPlaybackSources(kind: MediaKind, slug: string): Promise<PlaybackSource[]> {
    if (kind !== "movie") return [];
    const identifier = archiveIdentifier(slug);
    if (!identifier) throw new MediaProviderError("Unknown archive title", 404, "archive");
    return archivePlaybackSources(identifier);
  }

  /**
   * Find an archive copy of a film that another provider supplied the metadata for.
   * Only a strong match (same normalised title, same or adjacent year) is returned, so a
   * detail page never plays the wrong movie.
   */
  async matchFreeCopy(title: string, year?: number): Promise<MediaTitle | null> {
    const seeded = this.snapshot()
      .map((candidate) => ({ candidate, score: archiveMatchScore(candidate, title, year) }))
      .sort((a, b) => b.score - a.score)[0];
    if (seeded && seeded.score >= 6) return seeded.candidate;

    const live = await searchDocs(archiveMatchQuery(title, year), 1, 12, "downloads desc", 86_400);
    if (!live) return null;
    const best = mapDocs(live.docs)
      .map((candidate) => ({ candidate, score: archiveMatchScore(candidate, title, year) }))
      .sort((a, b) => b.score - a.score)[0];
    return best && best.score >= 6 ? best.candidate : null;
  }
}

/** Poster URL for an identifier, exported for the UI's archive links. */
export { archivePosterUrl, archiveSlug };
