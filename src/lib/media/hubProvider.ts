/**
 * Server-side 4KHDHub catalogue adapter implementing `MediaProvider`.
 *
 * Fetches publicly accessible listing/search/detail pages server-side via `safeFetchHtml`
 * (no client CORS proxies, explicit host allowlist, private-IP blocking, size & time bounds),
 * parses HTML safely via `cheerio` (`hubScraper.ts`), and exposes release qualities,
 * season packs and episode mirror links without executing untrusted markup.
 */

import { MediaProviderError, type MediaProvider } from "./provider";
import { filterTitles, sortTitles } from "./query";
import { SafeFetchError, safeFetchHtml, type DnsLookupFn } from "./safeFetch";
import {
  buildHubListUrl,
  hubBaseUrl,
  hubDetailUrlFromSlug,
  hubGenres,
  hubLanguages,
  parseHubDetailHtml,
  parseHubSearchHtml,
  type ParsedHubDetail,
  type ParsedHubListPage,
} from "./hubScraper";
import type {
  Genre,
  MediaDetail,
  MediaFacets,
  MediaKind,
  MediaPage,
  MediaQuery,
  MediaTitle,
  ProviderInfo,
  Season,
} from "./types";

export const HUB_PROVIDER_INFO: ProviderInfo = {
  id: "4khdhub",
  label: "4KHDHub",
  attribution: "Public web catalogue parsed server-side; verify media container compatibility before in-browser playback.",
  demo: false,
};

const LIST_TTL_MS = 5 * 60 * 1000;
const LIST_STALE_MS = 60 * 60 * 1000;
const DETAIL_TTL_MS = 15 * 60 * 1000;
const DETAIL_STALE_MS = 2 * 60 * 60 * 1000;
const PAGE_SIZE = 24;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

export interface HubProviderDeps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  timeoutMs?: number;
}

export class FourKHDHubMediaProvider implements MediaProvider {
  readonly info = HUB_PROVIDER_INFO;

  private readonly listCache = new Map<string, CacheEntry<ParsedHubListPage>>();
  private readonly detailCache = new Map<string, CacheEntry<ParsedHubDetail>>();
  private readonly listInflight = new Map<string, Promise<ParsedHubListPage>>();
  private readonly detailInflight = new Map<string, Promise<ParsedHubDetail | null>>();
  private readonly deps: HubProviderDeps;

  constructor(deps: HubProviderDeps = {}) {
    this.deps = deps;
  }

  private base(): string {
    return hubBaseUrl(this.deps.baseUrl);
  }

  private toProviderError(error: unknown): MediaProviderError {
    if (error instanceof MediaProviderError) return error;
    if (error instanceof SafeFetchError) {
      const status =
        error.code === "timeout"
          ? 504
          : error.code === "captcha" || error.code === "access_control"
            ? 403
            : error.code === "disallowed_host" || error.code === "blocked_ip" || error.code === "insecure_protocol"
              ? 403
              : 503;
      return new MediaProviderError(error.message, status, "4khdhub", error.code);
    }
    return new MediaProviderError(
      (error as Error)?.message || "Upstream catalogue provider is unavailable.",
      503,
      "4khdhub",
      "network_error"
    );
  }

  private loadListPageNetwork(url: string): Promise<ParsedHubListPage> {
    const existing = this.listInflight.get(url);
    if (existing) return existing;

    const req = (async () => {
      try {
        const res = await safeFetchHtml(url, {
          purpose: "catalogue",
          timeoutMs: this.deps.timeoutMs,
          fetchImpl: this.deps.fetchImpl,
          dnsLookup: this.deps.dnsLookup,
        });
        if (res.status === 404) {
          return { items: [], totalPages: 1 };
        }
        const parsed = parseHubSearchHtml(res.text, this.base());
        const now = Date.now();
        if (!this.listCache.has(url) && this.listCache.size >= 200) {
          const oldest = this.listCache.keys().next().value;
          if (oldest) this.listCache.delete(oldest);
        }
        this.listCache.set(url, {
          value: parsed,
          expiresAt: now + LIST_TTL_MS,
          staleUntil: now + LIST_STALE_MS,
        });
        return parsed;
      } catch (error) {
        throw this.toProviderError(error);
      } finally {
        this.listInflight.delete(url);
      }
    })();

    this.listInflight.set(url, req);
    return req;
  }

  private async fetchListPage(url: string): Promise<ParsedHubListPage> {
    const hit = this.listCache.get(url);
    const now = Date.now();
    if (hit) {
      if (hit.expiresAt > now) return hit.value;
      if (hit.staleUntil > now) {
        void this.loadListPageNetwork(url).catch(() => {});
        return hit.value;
      }
    }
    return this.loadListPageNetwork(url);
  }

  private loadDetailNetwork(pageUrl: string): Promise<ParsedHubDetail | null> {
    const existing = this.detailInflight.get(pageUrl);
    if (existing) return existing;

    const req = (async () => {
      try {
        const res = await safeFetchHtml(pageUrl, {
          purpose: "catalogue",
          referer: `${this.base()}/`,
          timeoutMs: this.deps.timeoutMs,
          fetchImpl: this.deps.fetchImpl,
          dnsLookup: this.deps.dnsLookup,
        });
        if (res.status === 404) return null;

        const parsed = parseHubDetailHtml(res.text, res.url || pageUrl, this.base());
        if (!parsed) return null;

        const now = Date.now();
        if (!this.detailCache.has(pageUrl) && this.detailCache.size >= 300) {
          const oldest = this.detailCache.keys().next().value;
          if (oldest) this.detailCache.delete(oldest);
        }
        this.detailCache.set(pageUrl, {
          value: parsed,
          expiresAt: now + DETAIL_TTL_MS,
          staleUntil: now + DETAIL_STALE_MS,
        });
        return parsed;
      } catch (error) {
        throw this.toProviderError(error);
      } finally {
        this.detailInflight.delete(pageUrl);
      }
    })();

    this.detailInflight.set(pageUrl, req);
    return req;
  }

  private async fetchDetail(slug: string): Promise<ParsedHubDetail | null> {
    const pageUrl = hubDetailUrlFromSlug(slug, this.base());
    if (!pageUrl) return null;

    const hit = this.detailCache.get(pageUrl);
    const now = Date.now();
    if (hit) {
      if (hit.expiresAt > now) return hit.value;
      if (hit.staleUntil > now) {
        void this.loadDetailNetwork(pageUrl).catch(() => {});
        return hit.value;
      }
    }
    return this.loadDetailNetwork(pageUrl);
  }

  /* ------------------------------ discovery ------------------------------ */

  async getTrendingMovies(limit = 20): Promise<MediaTitle[]> {
    const page = await this.fetchListPage(buildHubListUrl("movie", { page: 1 }, this.base()));
    return page.items.filter((i) => i.kind === "movie").slice(0, limit);
  }

  async getPopularMovies(limit = 20): Promise<MediaTitle[]> {
    const page = await this.fetchListPage(buildHubListUrl("movie", { page: 2 }, this.base()));
    const list = page.items.filter((i) => i.kind === "movie");
    return list.length ? list.slice(0, limit) : this.getTrendingMovies(limit);
  }

  async getNewMovieReleases(limit = 20): Promise<MediaTitle[]> {
    const items = await this.getTrendingMovies(limit * 2);
    return sortTitles(items, "newest").slice(0, limit);
  }

  async getTopRatedMovies(limit = 20): Promise<MediaTitle[]> {
    const page = await this.fetchListPage(`${this.base()}/category/bluray/`);
    const movies = page.items.filter((i) => i.kind === "movie");
    return (movies.length ? movies : await this.getTrendingMovies(limit)).slice(0, limit);
  }

  async getTrendingSeries(limit = 20): Promise<MediaTitle[]> {
    const page = await this.fetchListPage(buildHubListUrl("series", { page: 1 }, this.base()));
    return page.items.filter((i) => i.kind === "series").slice(0, limit);
  }

  async getPopularSeries(limit = 20): Promise<MediaTitle[]> {
    const page = await this.fetchListPage(buildHubListUrl("series", { page: 2 }, this.base()));
    const list = page.items.filter((i) => i.kind === "series");
    return list.length ? list.slice(0, limit) : this.getTrendingSeries(limit);
  }

  async getNewSeriesReleases(limit = 20): Promise<MediaTitle[]> {
    const items = await this.getTrendingSeries(limit * 2);
    return sortTitles(items, "newest").slice(0, limit);
  }

  async getTopRatedSeries(limit = 20): Promise<MediaTitle[]> {
    const items = await this.getTrendingSeries(limit);
    return items.slice(0, limit);
  }

  /* ------------------------------- browsing ------------------------------ */

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    const page = Math.max(1, Math.floor(query.page || 1));
    const url = buildHubListUrl(kind, { ...query, page }, this.base());
    const parsed = await this.fetchListPage(url);

    let filtered = parsed.items.filter((item) => item.kind === kind);
    // Apply client-equivalent facets not encoded directly into the upstream path
    filtered = filterTitles(filtered, {
      year: query.year,
      genre: query.q ? query.genre : undefined,
      language: query.q || query.genre ? query.language : undefined,
    });

    const sorted = query.sort && query.sort !== "trending" ? sortTitles(filtered, query.sort) : filtered;
    const totalPages = Math.max(1, parsed.totalPages);
    const totalResults = totalPages > 1 ? Math.max(sorted.length, totalPages * Math.max(sorted.length, 18)) : sorted.length;

    return {
      items: sorted,
      page,
      totalPages,
      totalResults,
      pageSize: PAGE_SIZE,
    };
  }

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 24): Promise<MediaTitle[]> {
    const term = query.trim();
    if (!term) return [];
    const url = buildHubListUrl("all", { q: term, page: 1 }, this.base());
    const parsed = await this.fetchListPage(url);
    const matched = kind === "all" ? parsed.items : parsed.items.filter((item) => item.kind === kind);
    return matched.slice(0, limit);
  }

  async getGenres(): Promise<Genre[]> {
    return hubGenres();
  }

  async getFacets(): Promise<MediaFacets> {
    const current = new Date().getFullYear();
    const years: (number | string)[] = [];
    for (let y = current; y >= current - 20; y--) years.push(y);
    for (let dec = Math.floor(current / 10) * 10; dec >= 1980; dec -= 10) years.push(`${dec}s`);
    return {
      genres: hubGenres(),
      years,
      languages: hubLanguages(),
    };
  }

  /* -------------------------------- details ------------------------------ */

  async getMovieDetails(slug: string): Promise<MediaDetail | null> {
    const parsed = await this.fetchDetail(slug);
    if (!parsed) return null;
    return {
      title: parsed.title,
      seasons: parsed.seasons,
      related: parsed.related,
      playback: [],
      releases: parsed.releases,
      provider: this.info,
      attribution: this.info.attribution,
    };
  }

  async getSeriesDetails(slug: string): Promise<MediaDetail | null> {
    const parsed = await this.fetchDetail(slug);
    if (!parsed) return null;
    return {
      title: { ...parsed.title, kind: "series" },
      seasons: parsed.seasons,
      related: parsed.related,
      playback: [],
      releases: parsed.releases,
      provider: this.info,
      attribution: this.info.attribution,
    };
  }

  async getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]> {
    const parsed = await this.fetchDetail(slug);
    if (!parsed) return [];
    if (seasonNumber === undefined) return parsed.seasons;
    return parsed.seasons.filter((s) => s.seasonNumber === seasonNumber);
  }

  async getRelated(_kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    const parsed = await this.fetchDetail(slug);
    return parsed ? parsed.related.slice(0, limit) : [];
  }
}
