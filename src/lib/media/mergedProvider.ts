/**
 * The router provider: rich metadata from TMDb (when configured) + free playback from the
 * Internet Archive.
 *
 * Two catalogues, one UI:
 *   • Metadata (posters, casts, trailers, "where to watch") comes from TMDb when
 *     credentials exist, otherwise the bundled demo catalogue.
 *   • Internet Archive titles are first-class citizens too — they appear in a
 *     "Free to watch" shelf, in search results and as their own detail pages
 *     (`ia-<identifier>` slugs route to the archive provider).
 *   • A metadata title whose film exists in the archive (same title and year) gets the
 *     archive's player attached, so classics actually play.
 *
 * Every method degrades instead of throwing: if TMDb is unreachable the browse falls back
 * to the archive, and if the archive is unreachable its provider serves a verified
 * snapshot. A page never dies because one upstream is down.
 */

import { archiveDownloadUrl, archivePlaybackSources, isArchiveSlug } from "./archive";
import { ArchiveMediaProvider, ARCHIVE_PROVIDER_INFO } from "./archiveProvider";
import { DemoMediaProvider } from "./demoProvider";
import type { MediaProvider } from "./provider";
import { TmdbMediaProvider, TMDB_PROVIDER_INFO, tmdbConfigured } from "./tmdbProvider";
import type {
  Genre,
  MediaDetail,
  MediaFacets,
  MediaKind,
  MediaPage,
  MediaQuery,
  MediaTitle,
  PlaybackSource,
  ProviderInfo,
  Season,
} from "./types";

export const MERGED_PROVIDER_INFO: ProviderInfo = {
  id: "merged",
  label: "TMDB + Internet Archive",
  attribution:
    "This product uses the TMDB API but is not endorsed or certified by TMDB. Free films stream from the Internet Archive (archive.org).",
  demo: false,
};

async function attempt<T>(task: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    console.warn("[media/merged] falling back:", (error as Error)?.message);
    return fallback();
  }
}

function mergeTitles(...lists: MediaTitle[][]): MediaTitle[] {
  const seen = new Set<string>();
  const out: MediaTitle[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.kind}:${item.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export class MergedMediaProvider implements MediaProvider {
  readonly info: ProviderInfo;

  private readonly archive = new ArchiveMediaProvider();
  private readonly demo = new DemoMediaProvider();
  private readonly metadata: MediaProvider;
  private readonly tmdb: boolean;

  constructor() {
    this.tmdb = tmdbConfigured();
    this.metadata = this.tmdb ? new TmdbMediaProvider() : this.demo;
    // With no metadata key the archive *is* the catalogue, so report it as such.
    this.info = this.tmdb ? MERGED_PROVIDER_INFO : ARCHIVE_PROVIDER_INFO;
  }

  /* _____________________________ discovery _____________________________ */

  private movieTask(task: (provider: MediaProvider) => Promise<MediaTitle[]>, archiveTask: () => Promise<MediaTitle[]>): Promise<MediaTitle[]> {
    if (!this.tmdb) return archiveTask();
    return attempt(() => task(this.metadata), archiveTask);
  }

  getTrendingMovies(limit = 20) {
    return this.movieTask((p) => p.getTrendingMovies(limit), () => this.archive.getTrendingMovies(limit));
  }
  getPopularMovies(limit = 20) {
    return this.movieTask((p) => p.getPopularMovies(limit), () => this.archive.getPopularMovies(limit));
  }
  getNewMovieReleases(limit = 20) {
    return this.movieTask((p) => p.getNewMovieReleases(limit), () => this.archive.getNewMovieReleases(limit));
  }
  getTopRatedMovies(limit = 20) {
    return this.movieTask((p) => p.getTopRatedMovies(limit), () => this.archive.getTopRatedMovies(limit));
  }

  getTrendingSeries(limit = 20) {
    return this.metadata.getTrendingSeries(limit);
  }
  getPopularSeries(limit = 20) {
    return this.metadata.getPopularSeries(limit);
  }
  getNewSeriesReleases(limit = 20) {
    return this.metadata.getNewSeriesReleases(limit);
  }
  getTopRatedSeries(limit = 20) {
    return this.metadata.getTopRatedSeries(limit);
  }

  /** The browser's "Free to watch" shelf: archive films, always playable. */
  getFreeToWatch(limit = 12) {
    return this.archive.getFreeToWatch(limit);
  }

  /* ______________________________ browsing _____________________________ */

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    if (kind === "series") return this.metadata.browse(kind, query);
    if (!this.tmdb) return this.archive.browse(kind, query);
    return attempt(
      () => this.metadata.browse(kind, query),
      () => this.archive.browse(kind, query)
    );
  }

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 24): Promise<MediaTitle[]> {
    const term = query.trim();
    if (!term) return [];
    if (!this.tmdb) {
      return kind === "series" ? this.demo.searchTitles(term, kind, limit) : this.archive.searchTitles(term, kind, limit);
    }

    const metadata = this.metadata.searchTitles(term, kind, limit).catch(() => []);
    const free = kind === "series" ? Promise.resolve([]) : this.archive.searchTitles(term, kind, Math.min(limit, 12));
    const [primary, archive] = await Promise.all([metadata, free]);
    return mergeTitles(primary, archive).slice(0, limit);
  }

  async getGenres(kind: MediaKind): Promise<Genre[]> {
    return kind === "movie" && !this.tmdb ? this.archive.getGenres() : this.metadata.getGenres(kind);
  }

  async getFacets(kind: MediaKind): Promise<MediaFacets> {
    if (kind === "movie" && !this.tmdb) return this.archive.getFacets(kind);
    return attempt(
      () => this.metadata.getFacets(kind),
      () => (kind === "movie" ? this.archive.getFacets(kind) : this.demo.getFacets(kind))
    );
  }

  /* ______________________________ details ______________________________ */

  async getMovieDetails(slug: string): Promise<MediaDetail | null> {
    if (isArchiveSlug(slug)) return this.archive.getMovieDetails(slug);
    if (!this.tmdb) return this.demo.getMovieDetails(slug);
    const detail = await this.metadata.getMovieDetails(slug).catch(() => null);
    if (!detail) return this.archive.getMovieDetails(slug);
    return this.attachFreeCopy(detail);
  }

  /**
   * If the film exists in the Internet Archive under the same title and year, attach its
   * player and download options. Nothing is attached unless the match is unambiguous.
   */
  private async attachFreeCopy(detail: MediaDetail): Promise<MediaDetail> {
    if (detail.title.kind !== "movie") return detail;
    const match = await this.archive.matchFreeCopy(detail.title.title, detail.title.year).catch(() => null);
    if (!match) return detail;

    const sources: PlaybackSource[] = archivePlaybackSources(match.id).map((source) => ({
      ...source,
      label: `Free · ${source.label}`,
      note: `Public-domain / openly licensed copy of “${match.title}” (${match.year ?? "archive.org"}) from the Internet Archive.`,
    }));
    const claimed = new Set(detail.playback.map((source) => source.url));
    const extra = sources.filter((source) => !claimed.has(source.url));
    if (extra.length === 0) return detail;

    const related = await this.archive.getRelated("movie", match.slug, 4).catch(() => []);

    return {
      ...detail,
      title: { ...detail.title, free: true, officialUrl: detail.title.officialUrl ?? match.officialUrl },
      playback: [...detail.playback, ...extra],
      downloads: [
        ...(detail.downloads ?? []),
        { label: "Internet Archive download options", url: archiveDownloadUrl(match.id), kind: "page" as const },
      ],
      related: mergeTitles(detail.related, related).slice(0, 12),
    };
  }

  async getSeriesDetails(slug: string): Promise<MediaDetail | null> {
    if (isArchiveSlug(slug)) return null;
    return this.metadata.getSeriesDetails(slug);
  }

  async getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]> {
    if (isArchiveSlug(slug)) return [];
    return this.metadata.getSeriesSeasons(slug, seasonNumber);
  }

  async getRelated(kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    if (isArchiveSlug(slug)) return this.archive.getRelated(kind, slug, limit);
    return this.metadata.getRelated(kind, slug, limit);
  }

  /* ______________________________ playback _____________________________ */

  async getPlaybackSources(kind: MediaKind, slug: string): Promise<PlaybackSource[]> {
    if (isArchiveSlug(slug)) return this.archive.getPlaybackSources(kind, slug);
    const sources = this.metadata.getPlaybackSources ? await this.metadata.getPlaybackSources(kind, slug) : [];
    if (kind !== "movie") return sources;
    const detail = await this.metadata.getMovieDetails(slug).catch(() => null);
    if (!detail) return sources;
    const match = await this.archive.matchFreeCopy(detail.title.title, detail.title.year).catch(() => null);
    return match ? [...sources, ...archivePlaybackSources(match.id)] : sources;
  }
}
/** Exported for the settings/about panel. */
export const MERGED_ATTRIBUTION = {
  tmdb: TMDB_PROVIDER_INFO.attribution,
  archive: ARCHIVE_PROVIDER_INFO.attribution,
};
