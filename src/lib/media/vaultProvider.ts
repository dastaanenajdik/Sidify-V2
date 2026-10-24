/**
 * Vault catalogue adapter implementing `MediaProvider`.
 *
 * Wraps the signed API client (`vaultClient.ts`) and the payload adapters
 * (`vaultAdapt.ts`) behind the same contract the other catalogue adapters use, so the
 * service layer can query it alongside the existing provider.
 *
 * Server-only.
 */

import { MediaProviderError, type MediaProvider } from "./provider";
import { mergeSearchResults } from "./query";
import { getVaultClient, VaultApiError, type VaultClient } from "./vaultClient";
import {
  detailsPayloadToDetail,
  isDeprecationNoticeUrl,
  playInfoToReleases,
  resourceItemToRelease,
  searchPayloadToTitles,
  subjectIdFromSlug,
  subjectIdOf,
  VAULT_SLUG_PREFIX,
} from "./vaultAdapt";
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
import { buildVaultStreamUrl } from "./vaultStream";

export const VAULT_PROVIDER_INFO: ProviderInfo = {
  id: "vault",
  label: "Vault",
  attribution:
    "Public catalogue metadata and stream links resolved server-side. Playback and downloads depend on upstream availability.",
  demo: false,
};

const DETAIL_TTL_MS = 15 * 60 * 1000;
const DETAIL_STALE_MS = 2 * 60 * 60 * 1000;
const SEARCH_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 24;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
}

/** Vault slugs are `vault-<subjectId>-<title>`; everything else is not ours. */
export function isVaultSlug(slug: string): boolean {
  return typeof slug === "string" && slug.startsWith(VAULT_SLUG_PREFIX) && subjectIdFromSlug(slug) !== null;
}

export class VaultMediaProvider implements MediaProvider {
  readonly info = VAULT_PROVIDER_INFO;

  private readonly detailCache = new Map<string, CacheEntry<MediaDetail | null>>();
  private readonly searchCache = new Map<string, CacheEntry<MediaTitle[]>>();

  constructor(private readonly client: VaultClient = getVaultClient()) {}

  private toProviderError(error: unknown): MediaProviderError {
    if (error instanceof MediaProviderError) return error;
    if (error instanceof VaultApiError) {
      const status =
        error.code === "hosts_exhausted" ? 503 : error.status && error.status >= 400 ? error.status : 502;
      return new MediaProviderError(error.message, status, VAULT_PROVIDER_INFO.id, error.code);
    }
    return new MediaProviderError(
      (error as Error)?.message || "Upstream catalogue provider is unavailable.",
      503,
      VAULT_PROVIDER_INFO.id,
      "network_error"
    );
  }

  /* ------------------------------ discovery ------------------------------ */

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 24): Promise<MediaTitle[]> {
    const term = query.trim();
    if (!term) return [];

    const cacheKey = `${kind}:${term.toLowerCase()}:${limit}`;
    const now = Date.now();
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) return cached.value.slice(0, limit);
      if (cached.staleUntil > now) {
        void this.loadSearch(term, kind, limit).catch(() => {});
        return cached.value.slice(0, limit);
      }
    }
    return this.loadSearch(term, kind, limit);
  }

  private async loadSearch(term: string, kind: MediaKind | "all", limit: number): Promise<MediaTitle[]> {
    try {
      const payload = await this.client.post("/wefeed-mobile-bff/subject-api/search/v2", {
        keyword: term,
        page: 1,
        perPage: 15,
        subjectType: 0,
      });
      const titles = searchPayloadToTitles(payload);
      const matched = kind === "all" ? titles : titles.filter((title) => title.kind === kind);
      const limited = matched.slice(0, limit);

      const now = Date.now();
      if (this.searchCache.size >= 200) {
        const oldest = this.searchCache.keys().next().value;
        if (oldest) this.searchCache.delete(oldest);
      }
      this.searchCache.set(cacheKeyFor(term, kind, limit), {
        value: limited,
        expiresAt: now + SEARCH_TTL_MS,
        staleUntil: now + DETAIL_STALE_MS,
      });
      return limited;
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  /**
   * The collection's own listing, used when nothing has been searched yet.
   *
   * Several broad terms are queried and their results merged, so the section always
   * has something to show even when the catalogue's own ranking endpoints are absent.
   */
  async discovery(kind: MediaKind | "all" = "all", limit = 24): Promise<MediaTitle[]> {
    if (kind === "all") {
      const [movies, series] = await Promise.all([
        this.discoveryQuery("movie", limit),
        this.discoveryQuery("series", limit),
      ]);
      const merged = mergeSearchResults(movies, series);
      return merged.slice(0, limit);
    }
    return this.discoveryQuery(kind, limit);
  }

  /** The catalogue is search-driven, so "trending" falls back to a broad query. */
  private async discoveryQuery(kind: MediaKind, limit: number): Promise<MediaTitle[]> {
    const terms =
      kind === "movie"
        ? ["2024", "2023", "action", "drama", "horror", "comedy"]
        : ["series", "2024", "drama", "comedy", "action", "thriller"];
    const collected: MediaTitle[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      if (collected.length >= limit) break;
      try {
        const titles = await this.searchTitles(term, kind, limit);
        for (const title of titles) {
          if (seen.has(title.id)) continue;
          seen.add(title.id);
          collected.push(title);
          if (collected.length >= limit) break;
        }
      } catch {
        /* one failing term must not break the rail */
      }
    }
    return collected.slice(0, limit);
  }

  async getTrendingMovies(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("movie", limit);
  }

  async getPopularMovies(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("movie", limit);
  }

  async getNewMovieReleases(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("movie", limit);
  }

  async getTopRatedMovies(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("movie", limit);
  }

  async getTrendingSeries(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("series", limit);
  }

  async getPopularSeries(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("series", limit);
  }

  async getNewSeriesReleases(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("series", limit);
  }

  async getTopRatedSeries(limit = 20): Promise<MediaTitle[]> {
    return this.discoveryQuery("series", limit);
  }

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    const page = Math.max(1, Math.floor(query.page || 1));
    const term = query.q?.trim();
    if (!term) {
      const items = await this.discoveryQuery(kind, PAGE_SIZE);
      return { items, page: 1, totalPages: 1, totalResults: items.length, pageSize: PAGE_SIZE };
    }

    const limit = page * PAGE_SIZE;
    const titles = await this.searchTitles(term, kind, limit);
    const start = (page - 1) * PAGE_SIZE;
    const items = titles.slice(start, start + PAGE_SIZE);
    return {
      items,
      page,
      totalPages: Math.max(1, Math.ceil(titles.length / PAGE_SIZE)),
      totalResults: titles.length,
      pageSize: PAGE_SIZE,
    };
  }

  async getGenres(kind: MediaKind): Promise<Genre[]> {
    const titles = await this.discoveryQuery(kind, 24);
    const genres = new Map<string, Genre>();
    for (const title of titles) {
      for (const genre of title.genres) {
        if (!genres.has(genre.id)) genres.set(genre.id, genre);
      }
    }
    return [...genres.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getFacets(kind: MediaKind): Promise<MediaFacets> {
    const current = new Date().getFullYear();
    const years: (number | string)[] = [];
    for (let year = current; year >= current - 20; year--) years.push(year);
    for (let decade = Math.floor(current / 10) * 10; decade >= 1980; decade -= 10) years.push(`${decade}s`);

    return {
      genres: await this.getGenres(kind),
      years,
      languages: [
        { code: "en", name: "English" },
        { code: "hi", name: "Hindi" },
        { code: "es", name: "Spanish" },
        { code: "fr", name: "French" },
        { code: "de", name: "German" },
        { code: "it", name: "Italian" },
        { code: "ja", name: "Japanese" },
        { code: "ko", name: "Korean" },
        { code: "zh", name: "Chinese" },
        { code: "pt", name: "Portuguese" },
      ],
    };
  }

  /* -------------------------------- details ------------------------------ */

  async getMovieDetails(slug: string): Promise<MediaDetail | null> {
    return this.loadDetail(slug, "movie");
  }

  async getSeriesDetails(slug: string): Promise<MediaDetail | null> {
    return this.loadDetail(slug, "series");
  }

  private async loadDetail(slug: string, kind: MediaKind): Promise<MediaDetail | null> {
    const subjectId = subjectIdFromSlug(slug);
    if (!subjectId) return null;

    const cacheKey = `${subjectId}:${kind}`;
    const now = Date.now();
    const cached = this.detailCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) return cached.value;
      if (cached.staleUntil > now) {
        void this.fetchDetail(subjectId, kind).catch(() => {});
        return cached.value;
      }
    }
    return this.fetchDetail(subjectId, kind);
  }

  private async fetchDetail(subjectId: string, kind: MediaKind): Promise<MediaDetail | null> {
    try {
      const payload = await this.client.get(`/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`);
      const parsed = detailsPayloadToDetail(payload);
      if (!parsed) return null;

      const title: MediaTitle = { ...parsed.title, kind };
      const seasons = parsed.seasons;

      const releases = await this.loadReleases(subjectId, kind === "series");

      const detail: MediaDetail = {
        title,
        seasons,
        related: [],
        playback: [],
        releases,
        provider: this.info,
        attribution: this.info.attribution,
      };

      const now = Date.now();
      if (this.detailCache.size >= 300) {
        const oldest = this.detailCache.keys().next().value;
        if (oldest) this.detailCache.delete(oldest);
      }
      this.detailCache.set(`${subjectId}:${kind}`, {
        value: detail,
        expiresAt: now + DETAIL_TTL_MS,
        staleUntil: now + DETAIL_STALE_MS,
      });
      return detail;
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  /**
   * Release qualities for a title: signed DASH streams (playback) plus direct file
   * links (downloads). Mirrors the reference client's `episode_streams` flow.
   */
  private async loadReleases(subjectId: string, isSeries: boolean) {
    const releases = [];

    try {
      const playInfo = await this.client.get(
        `/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=${subjectId}`,
      );
      releases.push(...playInfoToReleases(playInfo, 0, 0, this.client.userAgent));
    } catch {
      /* play-info is optional — direct files may still be available */
    }

    try {
      const resource = await this.client.get(
        `/wefeed-mobile-bff/subject-api/resource?subjectId=${subjectId}&page=1&perPage=20`,
      );
      const list = Array.isArray((resource as { list?: unknown })?.list)
        ? ((resource as { list: unknown[] }).list ?? [])
        : [];

      for (const entry of list) {
        const release = resourceItemToRelease(entry);
        if (!release) continue;
        releases.push(release);
      }
    } catch {
      /* resource listing is optional */
    }

    // Deduplicate by mirror URL.
    const seen = new Set<string>();
    return releases.filter((release) => {
      const key = release.mirrors.map((mirror) => mirror.shortUrl.split("?")[0]).join("|");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]> {
    const detail = await this.loadDetail(slug, "series");
    if (!detail) return [];

    const seasons = seasonNumber === undefined
      ? detail.seasons
      : detail.seasons.filter((season) => season.seasonNumber === seasonNumber);

    // Episodes carry their own streams, fetched lazily per season so a long-running
    // series never downloads every episode at once.
    const subjectId = subjectIdFromSlug(slug);
    if (!subjectId) return seasons;

    for (const season of seasons) {
      for (const episode of season.episodes) {
        try {
          episode.releases = await this.loadEpisodeReleases(subjectId, season.seasonNumber, episode.episodeNumber);
        } catch {
          episode.releases = [];
        }
      }
    }
    return seasons;
  }

  /** Signed streams + direct files for one episode. */
  private async loadEpisodeReleases(subjectId: string, season: number, episode: number) {
    const releases = [];

    try {
      const playInfo = await this.client.get(
        `/wefeed-mobile-bff/subject-api/play-info/v2?subjectId=${subjectId}&se=${season}&ep=${episode}`,
      );
      releases.push(...playInfoToReleases(playInfo, season, episode, this.client.userAgent));
    } catch {
      /* play-info is optional */
    }

    try {
      const resource = await this.client.get(
        `/wefeed-mobile-bff/subject-api/resource?subjectId=${subjectId}&se=${season}&ep=${episode}&page=1&perPage=20`,
      );
      const list = Array.isArray((resource as { list?: unknown })?.list)
        ? ((resource as { list: unknown[] }).list ?? [])
        : [];
      for (const entry of list) {
        const release = resourceItemToRelease(entry);
        if (!release) continue;
        // The listing is per episode, but only keep what really belongs to this one.
        if (release.seasonNumber !== undefined && release.seasonNumber !== season) continue;
        if (release.episodeNumber !== undefined && release.episodeNumber !== episode) continue;
        releases.push(release);
      }
    } catch {
      /* resource listing is optional */
    }

    const seen = new Set<string>();
    return releases.filter((release) => {
      const key = release.mirrors.map((mirror) => mirror.shortUrl.split("?")[0]).join("|");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Browser-playable streams for this title.
   *
   * The signed DASH manifest is exposed through the app's own relay, because a browser
   * cannot send the CDN's signed cookie on a cross-origin request.
   */
  async getPlaybackSources(kind: MediaKind, slug: string): Promise<PlaybackSource[]> {
    const detail = await this.loadDetail(slug, kind);
    if (!detail) return [];

    const sources: PlaybackSource[] = [];
    for (const release of detail.releases ?? []) {
      const mirror = release.mirrors.find((item) => item.shortUrl.includes("/dash/"));
      if (!mirror) continue;
      const label = release.quality ? `${release.quality}${release.container ? ` ${release.container}` : ""}` : undefined;
      sources.push({
        url: buildVaultStreamUrl(mirror.shortUrl, mirror.headers, undefined, directoryOf(mirror.shortUrl)),
        type: "dash",
        label,
        container: "DASH",
        note: "Adaptive stream relayed server-side to preserve the signed CDN authorisation.",
      });
    }
    return sources;
  }

  async getRelated(_kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    const detail = await this.loadDetail(slug, "movie");
    const title = detail?.title;
    if (!title) return [];
    try {
      const titles = await this.searchTitles(title.title, "all", limit + 4);
      return titles.filter((item) => item.id !== title.id).slice(0, limit);
    } catch {
      return [];
    }
  }
}

/* ------------------------------- helpers -------------------------------- */

function cacheKeyFor(term: string, kind: MediaKind | "all", limit: number): string {
  return `${kind}:${term.toLowerCase()}:${limit}`;
}

/** The directory a manifest lives in — DASH segments sit next to it. */
function directoryOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/[^/]*$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return undefined;
  }
}

let sharedProvider: VaultMediaProvider | null = null;

/** Process-wide provider instance. */
export function getVaultProvider(): VaultMediaProvider {
  if (!sharedProvider) sharedProvider = new VaultMediaProvider();
  return sharedProvider;
}
