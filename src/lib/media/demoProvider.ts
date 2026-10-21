/**
 * The bundled demo provider: no credentials, no network, no licensed playback.
 *
 * It serves `demoCatalog.ts` through the same interface a real adapter implements,
 * which is what lets the UI be built and reviewed before a licensed catalogue is
 * connected. Titles are placeholder data and every response is marked `demo: true`.
 */

import { demoCatalog, demoSeasons } from "./demoCatalog";
import type { MediaProvider } from "./provider";
import { buildFacets, queryTitles, relatedTitles, sortTitles } from "./query";
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

export const DEMO_PROVIDER_INFO: ProviderInfo = {
  id: "demo",
  label: "Demo catalogue",
  attribution: "Demo catalogue — placeholder titles and artwork. Connect a licensed provider for real metadata.",
  demo: true,
};

export class DemoMediaProvider implements MediaProvider {
  readonly info = DEMO_PROVIDER_INFO;

  private items(kind?: MediaKind): MediaTitle[] {
    const all = demoCatalog();
    return kind ? all.filter((t) => t.kind === kind) : all;
  }

  private top(list: MediaTitle[], limit: number): MediaTitle[] {
    return sortTitles(list, "trending").slice(0, limit);
  }

  async getTrendingMovies(limit = 20): Promise<MediaTitle[]> {
    return this.top(this.items("movie"), limit);
  }
  async getTrendingSeries(limit = 20): Promise<MediaTitle[]> {
    return this.top(this.items("series"), limit);
  }
  async getPopularMovies(limit = 20): Promise<MediaTitle[]> {
    return this.top(this.items("movie"), limit);
  }
  async getPopularSeries(limit = 20): Promise<MediaTitle[]> {
    return this.top(this.items("series"), limit);
  }
  async getNewMovieReleases(limit = 20): Promise<MediaTitle[]> {
    return sortTitles(this.items("movie"), "newest").slice(0, limit);
  }
  async getNewSeriesReleases(limit = 20): Promise<MediaTitle[]> {
    return sortTitles(this.items("series"), "newest").slice(0, limit);
  }
  async getTopRatedMovies(limit = 20): Promise<MediaTitle[]> {
    return sortTitles(this.items("movie"), "rating").slice(0, limit);
  }
  async getTopRatedSeries(limit = 20): Promise<MediaTitle[]> {
    return sortTitles(this.items("series"), "rating").slice(0, limit);
  }

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    // The demo catalogue is small; a 12-card page keeps the "Load more" path visible.
    return queryTitles(this.items(kind), query, 12);
  }

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 20): Promise<MediaTitle[]> {
    const pool = kind === "all" ? this.items() : this.items(kind);
    return queryTitles(pool, { q: query }, Math.max(1, limit)).items.slice(0, limit);
  }

  async getGenres(kind: MediaKind): Promise<Genre[]> {
    return this.getFacets(kind).then((facets) => facets.genres);
  }

  async getFacets(kind: MediaKind): Promise<MediaFacets> {
    return buildFacets(this.items(kind));
  }

  async getMovieDetails(slug: string): Promise<MediaDetail | null> {
    const title = this.items("movie").find((t) => t.slug === slug);
    if (!title) return null;
    return {
      title,
      seasons: [],
      related: relatedTitles(this.items("movie"), title),
      playback: [],
      provider: this.info,
      attribution: this.info.attribution,
    };
  }

  async getSeriesDetails(slug: string): Promise<MediaDetail | null> {
    const title = this.items("series").find((t) => t.slug === slug);
    if (!title) return null;
    return {
      title,
      seasons: demoSeasons(title),
      related: relatedTitles(this.items("series"), title),
      playback: [],
      provider: this.info,
      attribution: this.info.attribution,
    };
  }

  async getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]> {
    const title = this.items("series").find((t) => t.slug === slug);
    if (!title) return [];
    const seasons = demoSeasons(title);
    return seasonNumber === undefined ? seasons : seasons.filter((s) => s.seasonNumber === seasonNumber);
  }

  async getRelated(kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    const title = this.items(kind).find((t) => t.slug === slug);
    return title ? relatedTitles(this.items(kind), title, limit) : [];
  }

  /** No licensed playback is configured for the demo catalogue. */
  async getPlaybackSources(): Promise<PlaybackSource[]> {
    return [];
  }
}
