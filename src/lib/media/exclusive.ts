/**
 * The exclusive collection: its own landing page, search, filters and
 * recommendations.
 *
 * Everything in this module is **server-only** and answers from exactly one
 * catalogue (`vaultProvider`). The main catalogue is never consulted, so a
 * title from it can never appear on `/exclusive` or in its results.
 *
 * Design goals that shaped this file:
 *
 *   1. **One upstream read per page view.** The provider caches its listing;
 *      every rail, facet and recommendation here is derived from that single
 *      pool, so the landing page costs one round trip — not one per rail.
 *   2. **Deterministic output.** Rankings, filters and recommendations are pure
 *      functions (`recommend.ts`) with stable tie-breaks, so the page does not
 *      reshuffle between two requests and CDN caching is meaningful.
 *   3. **Honest errors.** An unreachable catalogue throws (the route answers
 *      with a coded error); it is never rendered as "the collection is empty".
 */

import {
  dedupeTitles,
  popularGenres,
  filterTitles,
  genresFromTitles,
  highlyRated,
  languagesFromTitles,
  matchesText,
  newestTitles,
  numericYear,
  rankScore,
  rankTitles,
  recommendTitles,
  sortTitles,
  yearsFromTitles,
} from "./recommend";
import type {
  ExclusiveHome,
  ExclusiveQuery,
  ExclusiveRail,
  ExclusiveSearchPage,
  ExclusiveTitleResponse,
  ExclusiveSuggestions,
  Genre,
  MediaDetail,
  MediaFacets,
  MediaKind,
  MediaSort,
  MediaTitle,
  PlaybackSource,
  ProviderInfo,
} from "./types";
import { getVaultProvider, type VaultMediaProvider } from "./vaultProvider";

/** How long an assembled landing page is reused inside one serverless instance. */
const HOME_TTL_MS = 5 * 60 * 1000;
/** Results per search page. */
export const EXCLUSIVE_PAGE_SIZE = 24;
/** How many titles one search term is asked for, so a page beyond the first still fills. */
const SEARCH_POOL_LIMIT = 90;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const homeCache = new Map<string, CacheEntry<ExclusiveHome>>();
const titleCache = new Map<string, CacheEntry<ExclusiveTitleResponse>>();

/** Test seam: drop all memoised pages. */
export function clearExclusiveCache(): void {
  homeCache.clear();
  titleCache.clear();
}

/* ------------------------------- facets ---------------------------------- */

/** Filter options derived from a real pool of titles. */
export function facetsFor(pool: readonly MediaTitle[]): MediaFacets {
  const current = new Date().getFullYear();
  const years = yearsFromTitles(pool);
  for (let decade = Math.floor(current / 10) * 10; decade >= 1980; decade -= 10) {
    const bucket = `${decade}s`;
    if (!years.includes(bucket)) years.push(bucket);
  }
  return {
    genres: genresFromTitles(pool),
    years,
    languages: languagesFromTitles(pool),
  };
}

/* ------------------------------ landing page ----------------------------- */

/**
 * Assemble the landing page from a listing.
 *
 * Pure and exported so the Node tests can assert rail composition without a
 * network call: given a pool, the same rails must always come out.
 */
export function buildExclusiveHome(
  pool: readonly MediaTitle[],
  provider: ProviderInfo,
  now = new Date()
): ExclusiveHome {
  const titles = dedupeTitles(pool);
  const genres = genresFromTitles(titles);
  const ranked = rankTitles(titles);

  const movies = titles.filter((title) => title.kind === "movie");
  const series = titles.filter((title) => title.kind === "series");

  // The spotlight is the collection's best-rated title (votes break ties), so
  // "Featured" always points at something worth clicking — never a placeholder
  // title that merely happens to rank high on popularity.
  const rated = [...ranked].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0)
  );
  const spotlight =
    rated.find((title) => typeof title.rating === "number" && title.rating >= 7) ??
    rated.find((title) => Boolean(title.poster)) ??
    ranked[0] ??
    null;

  const rails: ExclusiveRail[] = [];
  const push = (rail: ExclusiveRail) => {
    if (rail.items.length) rails.push(rail);
  };

  push({
    id: "trending",
    title: "Trending this week",
    subtitle: "The collection's most-watched titles right now",
    layout: "poster",
    items: ranked.slice(0, 14),
  });

  push({
    id: "top10",
    title: "Top 10 right now",
    subtitle: "Ranked by audience rating",
    layout: "ranked",
    items: sortTitles(titles, "rating").slice(0, 10),
  });

  push({
    id: "new-releases",
    title: "New releases",
    subtitle: "Fresh additions, newest first",
    layout: "poster",
    items: newestTitles(titles, 14),
  });

  push({
    id: "films",
    title: "Films",
    subtitle: "Feature-length picks",
    layout: "poster",
    items: rankTitles(movies).slice(0, 14),
  });

  push({
    id: "series",
    title: "Series",
    subtitle: "Shows worth binge-watching",
    layout: "poster",
    items: rankTitles(series).slice(0, 14),
  });

  push({
    id: "acclaimed",
    title: "Critically acclaimed",
    subtitle: "Rated 7.5 and above",
    layout: "poster",
    items: highlyRated(titles, 7.5, 12),
  });

  // Late 20th century and older — a different shelf from "new releases", and it
  // only appears when the catalogue actually holds older titles.
  push({
    id: "classics",
    title: "Timeless classics",
    subtitle: "Older titles still worth a night",
    layout: "poster",
    items: ranked
      .filter((title) => {
        const year = numericYear(title);
        return year !== null && year < now.getFullYear() - 10;
      })
      .slice(0, 12),
  });

  return {
    mode: "home",
    spotlight,
    rails,
    genres,
    facets: facetsFor(titles),
    total: titles.length,
    updatedAt: now.toISOString(),
    provider,
  };
}

/**
 * The landing page.
 *
 * `kind` narrows the rails to one media type; the spotlight and genres still
 * come from the full collection so the header never goes blank.
 */
export async function getExclusiveHome(
  kind: MediaKind | "all" = "all",
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveHome> {
  const cacheKey = kind;
  const cached = homeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pool = await provider.listing();
  const home = buildExclusiveHome(pool, provider.info);

  if (kind !== "all") {
    home.rails = home.rails
      .map((rail) => ({ ...rail, items: rail.items.filter((title) => title.kind === kind) }))
      .filter((rail) => rail.items.length > 0);
  }
  homeCache.set(cacheKey, { value: home, expiresAt: Date.now() + HOME_TTL_MS });
  return home;
}

/* -------------------------------- search --------------------------------- */

export interface ExclusiveSearchOptions extends ExclusiveQuery {
  /** Extra titles of context, so the pool can also answer "more like this". */
  seed?: MediaTitle | null;
}

export interface ExclusiveSearchResult extends ExclusiveSearchPage {
  /** The full filtered pool, before pagination — used for recommendations. */
  pool: MediaTitle[];
}

/**
 * Filter, sort and paginate the collection.
 *
 * With a term the catalogue's own search endpoint answers; without one the
 * cached listing is the pool. If the search endpoint returns nothing for a
 * term that the listing clearly contains, the listing's text match is used
 * instead — a keyword search that misses a title the catalogue holds is the
 * bug this section used to have.
 */
export async function searchExclusiveCatalogue(
  options: ExclusiveSearchOptions = {},
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveSearchResult> {
  const startedAt = Date.now();
  const kind: MediaKind | "all" = options.kind ?? "all";
  const term = (options.q || "").trim();
  const sort: MediaSort = options.sort ?? "trending";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(60, Math.max(1, Math.floor(options.limit ?? EXCLUSIVE_PAGE_SIZE)));

  let pool: MediaTitle[];
  if (term) {
    const searched = await provider.searchTitles(term, "all", SEARCH_POOL_LIMIT);
    if (searched.length >= 10) {
      // The catalogue's own search answered well — no need for a second read.
      pool = searched;
    } else {
      // Few or no search hits: the cached listing can still hold titles whose
      // text matches but whose entry the search index missed.
      const listing = await provider.listing().catch(() => [] as MediaTitle[]);
      const fromListing = listing.filter((title) => matchesText(title, term));
      pool = dedupeTitles([...searched, ...fromListing]);
    }
  } else {
    pool = await provider.listing();
  }

  const filtered = filterTitles(pool, {
    kind,
    genre: options.genre,
    year: options.year,
    language: options.language,
    q: term,
  });
  const sorted = sortTitles(filtered, sort);
  const totalPages = Math.max(1, Math.ceil(sorted.length / limit));
  // A stale link or a filter change can point past the last page; clamp instead
  // of answering with an empty grid that looks like "no matches".
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * limit;
  const items = sorted.slice(start, start + limit);

  return {
    mode: "search",
    query: term,
    items,
    pool: sorted,
    page: currentPage,
    totalPages,
    totalResults: sorted.length,
    pageSize: limit,
    filters: {
      kind,
      genre: options.genre,
      year: options.year,
      language: options.language,
      sort,
    },
    facets: facetsFor(pool),
    genres: genresFromTitles(pool),
    provider: provider.info,
    tookMs: Date.now() - startedAt,
  };
}

/** Strip the internal pool before a page is sent to the browser. */
export function toPublicSearchPage(result: ExclusiveSearchResult): ExclusiveSearchPage {
  const { pool: _pool, ...page } = result;
  return page;
}

/* ------------------------------- typeahead ------------------------------- */

/** Fast suggestions for the search field: listing text first, search as fallback. */
export async function suggestExclusive(
  query: string,
  limit = 8,
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveSuggestions> {
  const startedAt = Date.now();
  const term = (query || "").trim();
  if (term.length < 2) return { query: term, items: [], tookMs: Date.now() - startedAt };

  let pool: MediaTitle[] = [];
  try {
    pool = await provider.listing();
  } catch {
    pool = [];
  }

  const needle = term.toLowerCase();
  const scored = pool
    .map((title) => {
      const name = title.title.toLowerCase();
      const score = name.startsWith(needle) ? 3 : name.includes(needle) ? 2 : matchesText(title, term) ? 1 : 0;
      return { title, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (b.title.rating ?? 0) - (a.title.rating ?? 0))
    .slice(0, limit)
    .map((entry) => entry.title);

  let items = scored;
  if (items.length < 3) {
    try {
      const searched = await provider.searchTitles(term, "all", limit);
      items = dedupeTitles([...items, ...searched]).slice(0, limit);
    } catch {
      /* suggestions are best-effort */
    }
  }

  return { query: term, items, tookMs: Date.now() - startedAt };
}

/* -------------------------------- detail --------------------------------- */

const PLAYABLE_EXTENSIONS = /\.(mp4|m4v|webm|m3u8|mpd)$/i;

/**
 * Extra browser-playable sources from the collection's own resource listing.
 *
 * Direct files are offered as downloads elsewhere, but an MP4/WebM/HLS/DASH
 * resource is also a perfectly good playback source — and for a title with no
 * DASH manifest it is the *only* one. MKV and archives stay download-only.
 */
export function playableFromResources(detail: MediaDetail): PlaybackSource[] {
  const out: PlaybackSource[] = [];
  const seen = new Set<string>((detail.playback ?? []).map((source) => source.url));

  for (const release of detail.releases ?? []) {
    if (release.isPack) continue;
    const container = String(release.container || "").toLowerCase();
    if (container === "mkv" || container === "zip" || container === "rar" || container === "7z") continue;

    for (const mirror of release.mirrors) {
      const url = mirror.shortUrl?.trim();
      if (!url || !/^https?:\/\//i.test(url)) continue;
      if (seen.has(url)) continue;

      const path = url.split(/[?#]/)[0];
      const extension = (path.match(PLAYABLE_EXTENSIONS)?.[1] || container).toLowerCase();
      const type: PlaybackSource["type"] | null =
        extension === "mp4" || extension === "m4v"
          ? "mp4"
          : extension === "webm"
            ? "webm"
            : extension === "m3u8"
              ? "hls"
              : extension === "mpd"
                ? "dash"
                : null;
      if (!type) continue;

      seen.add(url);
      out.push({
        url,
        type,
        label: release.quality,
        container: extension.toUpperCase(),
        note: "Direct file from the collection — no relay needed.",
      });
    }
  }
  return out;
}

/**
 * One title with its own recommendations.
 *
 * The kind is inferred from the collection listing when it is not supplied
 * (a series opened through a movie URL used to load as a movie and come back
 * empty), then the provider's own detail is used.
 */
export async function getExclusiveTitle(
  slug: string,
  kind?: MediaKind,
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveTitleResponse | null> {
  const cached = titleCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const resolvedKind = kind ?? (await inferKind(provider, slug));
  const detail = resolvedKind === "movie" ? await provider.getMovieDetails(slug) : await provider.getSeriesDetails(slug);
  if (!detail) return null;

  let pool: MediaTitle[] = [];
  try {
    pool = await provider.listing();
  } catch {
    pool = [];
  }

  const recommendations = recommendTitles(detail.title, pool, 12);

  // The provider's own browser sources (signed DASH through the relay) are not
  // part of the detail payload — they come from `getPlaybackSources`. Direct
  // files from the resource listing are added on top, MKV/archives excluded.
  const providerSources = provider.getPlaybackSources
    ? await provider.getPlaybackSources(resolvedKind, slug).catch(() => [])
    : [];
  const playback = dedupePlayback([
    ...(detail.playback ?? []),
    ...providerSources,
    ...playableFromResources({ ...detail, playback: detail.playback ?? [] }),
  ]);

  const value: ExclusiveTitleResponse = {
    detail: { ...detail, playback, related: recommendations },
    recommendations,
    provider: provider.info,
  };
  titleCache.set(slug, { value, expiresAt: Date.now() + HOME_TTL_MS });
  return value;
}

function dedupePlayback(sources: PlaybackSource[]): PlaybackSource[] {
  const seen = new Set<string>();
  const out: PlaybackSource[] = [];
  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
  }
  return out;
}

async function inferKind(provider: VaultMediaProvider, slug: string): Promise<MediaKind> {
  try {
    const pool = await provider.listing();
    const match = pool.find((title) => title.slug === slug || title.id === slug);
    if (match) return match.kind;
  } catch {
    /* fall through to the movie-first probe */
  }
  return "movie";
}

/* ------------------------------- utilities ------------------------------- */

/** A random spotlight pick — used by the "Surprise me" button. */
export function randomTitle(titles: readonly MediaTitle[], random = Math.random): MediaTitle | null {
  if (!titles.length) return null;
  return titles[Math.min(titles.length - 1, Math.floor(random() * titles.length))];
}

/** Exposed for the tests and for callers that need the raw ranking score. */
export { popularGenres, rankScore };
