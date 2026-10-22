/**
 * The provider contract every catalogue adapter implements.
 *
 * A provider is an *authorized* source of metadata: an official API with credentials,
 * a licensed catalogue, or the bundled demo catalogue. It never supplies a stream
 * unless it is licensed to stream that title (`getPlaybackSources`), which is why the
 * method is optional and returns an empty list by default.
 */

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

export interface MediaProvider {
  readonly info: ProviderInfo;

  /* ------------------------------ discovery ------------------------------ */
  getTrendingMovies(limit?: number): Promise<MediaTitle[]>;
  getTrendingSeries(limit?: number): Promise<MediaTitle[]>;
  getPopularMovies(limit?: number): Promise<MediaTitle[]>;
  getPopularSeries(limit?: number): Promise<MediaTitle[]>;
  getNewMovieReleases(limit?: number): Promise<MediaTitle[]>;
  getNewSeriesReleases(limit?: number): Promise<MediaTitle[]>;
  getTopRatedMovies(limit?: number): Promise<MediaTitle[]>;
  getTopRatedSeries(limit?: number): Promise<MediaTitle[]>;
  /**
   * Films that stream free of charge (public-domain / open-licence catalogues).
   * Optional: providers without a free tier simply omit it, and the browse page
   * then shows no "free to watch" shelf.
   */
  getFreeToWatch?(limit?: number): Promise<MediaTitle[]>;

  /* ------------------------------- browsing ------------------------------ */
  /** Filtered, sorted, paginated catalogue. */
  browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage>;
  searchTitles(query: string, kind?: MediaKind | "all", limit?: number): Promise<MediaTitle[]>;
  getGenres(kind: MediaKind): Promise<Genre[]>;
  /** Genres, years and languages available for the filter bar. */
  getFacets(kind: MediaKind): Promise<MediaFacets>;

  /* -------------------------------- details ------------------------------ */
  getMovieDetails(slug: string): Promise<MediaDetail | null>;
  getSeriesDetails(slug: string): Promise<MediaDetail | null>;
  /** Season metadata, optionally with the episodes of one season. */
  getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]>;
  getRelated(kind: MediaKind, slug: string, limit?: number): Promise<MediaTitle[]>;

  /* ------------------------------- playback ------------------------------ */
  /**
   * Authorized playback URLs for this title, or `[]`. Only a licensed provider or
   * the site operator's own configured manifest may answer here.
   */
  getPlaybackSources?(kind: MediaKind, slug: string): Promise<PlaybackSource[]>;
}

/** Thrown when a provider is configured but rejects or fails a request. */
export class MediaProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "MediaProviderError";
  }
}
