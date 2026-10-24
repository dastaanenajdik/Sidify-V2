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
import { getVaultClient, VaultApiError, type VaultClient } from "./vaultClient";
import {
  detailsPayloadToDetail,
  homepagePayloadToTitles,
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

/**
 * The catalogue's homepage tabs.
 *
 * Tab "2" is the one the reference client opens on its first screen; the others
 * are read as well so the listing covers more than a single row type. A tab that
 * does not answer is skipped — the listing merges whatever does come back.
 */
const HOMEPAGE_TAB_IDS = ["2", "1", "3"];

/** How long the homepage listing stays fresh, and how long it may be served stale. */
const HOMEPAGE_TTL_MS = 5 * 60 * 1000;
const HOMEPAGE_STALE_MS = 30 * 60 * 1000;

/** How many titles the homepage listing keeps — enough to fill either kind's shelf. */
const HOMEPAGE_CACHE_SIZE = 200;

/**
 * How long the whole listing may take.
 *
 * Each tab has its own request timeout, and reading several tabs one after
 * another can add up to more than a serverless function is allowed to run. Once
 * the budget is spent and at least one tab has answered, the rest are skipped —
 * a short listing is better than a request that never returns.
 */
const HOMEPAGE_TIME_BUDGET_MS = 9_000;

/** How long the last-resort search may take before the section gives up. */
const FALLBACK_TIME_BUDGET_MS = 5_000;

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
  /** The homepage listing — one upstream round trip for the whole collection. */
  private homepageCache: CacheEntry<MediaTitle[]> | null = null;
  /**
   * A listing request that is already in flight.
   *
   * The listing is asked for more than once per page load (the section itself,
   * plus the movies/series fallbacks, which run together). Without this each of
   * those starts its own read of every tab, so one page load can make half a
   * dozen identical upstream calls.
   */
  private homepageInFlight: Promise<MediaTitle[]> | null = null;

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

  /**
   * The structural shape of a response, for the logs.
   *
   * Keys, types and the envelope's status fields — never a title, an artwork URL
   * or any other payload value. Enough to tell a shape change from an empty
   * catalogue, safe to leave in production logs.
   */
  private responseShape(payload: unknown): Record<string, unknown> {
    const diagnostics = this.client.describeLastResponse();
    if (!diagnostics) return { keys: payloadKeys(payload) };

    return {
      keys: diagnostics.payloadKeys.length ? diagnostics.payloadKeys : payloadKeys(payload),
      status: diagnostics.status,
      envelopeCode: diagnostics.envelopeCode,
      envelopeMessage: diagnostics.envelopeMessage,
      skeleton: diagnostics.skeleton,
    };
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
      if (!titles.length) {
        // An empty answer for a real keyword is worth a log line: it separates
        // "no match for this word" from "the payload shape changed".
        console.warn("[vault] search answered without any subjects", {
          term,
          ...this.responseShape(payload),
        });
      }
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
   * This is the catalogue's **homepage** endpoint — the same rows the reference
   * client shows on its first screen. It is the only listing the catalogue really
   * has; searching for generic words like "2024" or "action" matches no title at
   * all, which is why the section used to come up empty.
   *
   * The listing mixes movies and series, so a kind filter is applied afterwards.
   */
  async discovery(kind: MediaKind | "all" = "all", limit = 24): Promise<MediaTitle[]> {
    // The listing is filtered by kind *after* it is collected, so the whole
    // listing is needed here — slicing first could starve the filter.
    let titles: MediaTitle[] = [];
    let listingError: unknown = null;
    try {
      titles = await this.homepage(HOMEPAGE_CACHE_SIZE);
    } catch (error) {
      listingError = error;
      console.warn("[vault] the homepage listing could not be read", {
        error: describeError(error),
      });
    }

    const matched = kind === "all" ? titles : titles.filter((title) => title.kind === kind);
    if (matched.length) return matched.slice(0, limit);

    // The homepage came back empty. A broad search is the safety net so the
    // section is never blank.
    let fallback: MediaTitle[];
    try {
      if (kind === "all") {
        const [movies, series] = await Promise.all([
          this.discoveryQuery("movie", limit),
          this.discoveryQuery("series", limit),
        ]);
        const merged = [...movies, ...series];
        const seen = new Set<string>();
        fallback = merged.filter((title) => {
          if (seen.has(title.id)) return false;
          seen.add(title.id);
          return true;
        });
      } else {
        fallback = await this.discoveryQuery(kind, limit);
      }
    } catch (error) {
      throw this.toProviderError(listingError ?? error);
    }

    if (fallback.length) return fallback.slice(0, limit);
    // Nothing to show, and the listing never answered: that is a failure, and it
    // must reach the UI as one rather than as an empty collection.
    if (listingError) throw this.toProviderError(listingError);
    return [];
  }

  /**
   * The catalogue's homepage rows.
   *
   * `tab-operating` answers with `items`: groups of rows, each carrying its
   * subjects in a banner, a custom row or a plain grid. Several tabs are read and
   * merged so the listing is not limited to one row type.
   */
  private async homepage(limit: number): Promise<MediaTitle[]> {
    const now = Date.now();
    const cached = this.homepageCache;
    if (cached) {
      if (cached.expiresAt > now) return cached.value.slice(0, limit);
      // Stale: serve what we have and refresh in the background.
      if (cached.staleUntil > now) {
        void this.loadHomepage().catch(() => {});
        return cached.value.slice(0, limit);
      }
    }

    // Share one read between callers that arrive while it is still running.
    if (this.homepageInFlight) {
      return (await this.homepageInFlight).slice(0, limit);
    }

    const load = this.loadHomepage(limit).finally(() => {
      this.homepageInFlight = null;
    });
    this.homepageInFlight = load;
    return load;
  }

  /** Reads every homepage tab and merges the rows into one listing. */
  private async loadHomepage(limit = HOMEPAGE_CACHE_SIZE): Promise<MediaTitle[]> {
    const collected: MediaTitle[] = [];
    const seen = new Set<string>();
    let attempts = 0;
    let failures = 0;
    let lastError: unknown = null;
    const startedAt = Date.now();

    for (const tabId of HOMEPAGE_TAB_IDS) {
      // Stop reading further tabs once the budget is gone and there is something
      // to show; a partial listing beats a function that never returns.
      if (collected.length && Date.now() - startedAt > HOMEPAGE_TIME_BUDGET_MS) break;
      attempts += 1;
      try {
        const payload = await this.client.get(
          `/wefeed-mobile-bff/tab-operating?page=1&tabId=${encodeURIComponent(tabId)}&version=`
        );
        const titles = homepagePayloadToTitles(payload);
        // A tab that answers with nothing is worth knowing about: it is the
        // difference between "the endpoint has no rows" and "the payload shape
        // is not the one we expect", and the two look identical from the UI.
        if (!titles.length) {
          console.warn("[vault] homepage tab answered without any subjects", {
            tabId,
            ...this.responseShape(payload),
          });
        }
        for (const title of titles) {
          if (seen.has(title.id)) continue;
          seen.add(title.id);
          collected.push(title);
        }
      } catch (error) {
        // One failing tab must not break the listing — but it must be visible.
        failures += 1;
        lastError = error;
        console.warn("[vault] homepage tab failed", { tabId, error: describeError(error) });
      }
    }

    // Nothing answered at all. Returning an empty list here would be reported as
    // "the collection is empty" when in truth the catalogue could not be read —
    // the two must stay distinguishable all the way up to the UI.
    if (attempts > 0 && failures === attempts) {
      throw lastError ?? new Error("The listing endpoint could not be reached.");
    }

    const value = collected.slice(0, limit);
    const now = Date.now();
    this.homepageCache = {
      value,
      expiresAt: now + HOMEPAGE_TTL_MS,
      staleUntil: now + HOMEPAGE_STALE_MS,
    };
    return value;
  }

  /**
   * The catalogue has no separate ranking endpoint, so the rails fall back to the
   * homepage listing (filtered by kind) and finally to a broad search.
   */
  private async discoveryQuery(kind: MediaKind, limit: number): Promise<MediaTitle[]> {
    // The homepage listing first — it is the catalogue's own ranking.
    try {
      const listed = await this.homepage(HOMEPAGE_CACHE_SIZE);
      const matched = listed.filter((title) => title.kind === kind);
      if (matched.length) return matched.slice(0, limit);
    } catch {
      /* fall through to the search fallback */
    }

    // The homepage came back empty — a broad search is the safety net so a rail
    // is never blank.
    // The search endpoint matches **title text**, so a genre word like "drama"
    // matches no title at all. These are words that occur in a great many
    // titles, which makes them the only useful last resort.
    const terms = ["love", "night", "war", "dark", "city", "girl"];
    const collected: MediaTitle[] = [];
    const seen = new Set<string>();
    // Each term can itself cost a retry, so this loop needs a ceiling too — an
    // upstream that rejects every call must not hold the function open.
    const deadline = Date.now() + FALLBACK_TIME_BUDGET_MS;
    for (const term of terms) {
      if (collected.length >= limit) break;
      if (Date.now() > deadline) break;
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

/* ------------------------------ diagnostics ------------------------------ */

/**
 * The top-level keys of a payload.
 *
 * Logged when a listing comes back empty, so a shape change upstream shows up
 * in the server logs instead of only as an empty page.
 */
function payloadKeys(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  return Object.keys(payload as Record<string, unknown>).slice(0, 12);
}

/** A short, log-safe description of an error. */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
