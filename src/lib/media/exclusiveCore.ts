/**
 * The exclusive collection's composition layer.
 *
 * Every payload the section renders — landing rails, search pages, typeahead,
 * title pages with recommendations — is assembled here from a **catalogue
 * reader**. A reader is the only thing that knows *where the bytes come from*:
 *
 *   - `relay`  → `VaultMediaProvider` on the server (same-origin API routes)
 *   - `direct` → the user's own browser (`exclusiveDirect.ts`), so the upstream
 *                sees a residential IP instead of the deployment's datacenter
 *                range
 *
 * Keeping the composition transport-agnostic is what makes the client-side
 * path possible at all: the ranking, filtering and recommendation rules are
 * written once, tested once, and behave identically on both paths. Nothing in
 * this file may import a Node built-in or a server-only module — it ships to
 * the browser.
 */

import {
  dedupeTitles,
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

/* ------------------------------- reader ---------------------------------- */

/**
 * Where an exclusive payload comes from.
 *
 * `source` is carried into the UI so a "residential" vs "relay" fetch can be
 * told apart in diagnostics and in the console warning the section shows when
 * it has to fall back.
 */
export interface CatalogueReader {
  readonly source: "direct" | "relay";
  /** The collection's own listing (both kinds), already deduplicated upstream. */
  listing(): Promise<MediaTitle[]>;
  /** The catalogue's keyword search. Never the main catalogue's. */
  search(term: string, limit: number): Promise<MediaTitle[]>;
  /** One title with its releases and playback sources already merged. */
  detail(slug: string, kind: MediaKind): Promise<MediaDetail | null>;
}

/** How many titles one search term is asked for, so later pages still fill. */
export const SEARCH_POOL_LIMIT = 90;
/** Results per page unless the caller asks otherwise. */
export const EXCLUSIVE_PAGE_SIZE = 24;

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
 * Pure: given a pool, the same rails always come out. That is what makes the
 * page cacheable on the CDN and testable without a network call.
 */
export function buildExclusiveHome(pool: readonly MediaTitle[], provider: ProviderInfo, now = new Date()): ExclusiveHome {
  const titles = dedupeTitles(pool);
  const genres = genresFromTitles(titles);
  const ranked = rankTitles(titles);

  const movies = titles.filter((title) => title.kind === "movie");
  const series = titles.filter((title) => title.kind === "series");

  // The spotlight is the collection's best-rated title (votes break ties), so
  // "Featured" always points at something worth clicking — never a placeholder
  // title that merely happens to rank high on popularity.
  const rated = [...ranked].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0));
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

/** The landing payload for one reader. */
export async function getExclusiveHome(reader: CatalogueReader, kind: MediaKind | "all" = "all"): Promise<ExclusiveHome> {
  const pool = await reader.listing();
  const home = buildExclusiveHome(pool, providerOf(reader));

  if (kind !== "all") {
    home.rails = home.rails
      .map((rail) => ({ ...rail, items: rail.items.filter((title) => title.kind === kind) }))
      .filter((rail) => rail.items.length > 0);
  }
  return home;
}

/** Provider info for the payload; the reader may not expose one (direct path). */
function providerOf(reader: CatalogueReader): ProviderInfo {
  return {
    id: "vault",
    label: "Vault",
    attribution:
      "Public catalogue metadata and stream links resolved for this session. Playback and downloads depend on upstream availability.",
    demo: false,
  };
}

/* -------------------------------- search --------------------------------- */

export interface ExclusiveSearchOptions extends ExclusiveQuery {
  /** Extra titles of context, so the pool can also answer "more like this". */
  seed?: MediaTitle | null;
}

export interface ExclusiveSearchResult extends ExclusiveSearchPage {
  /** The full filtered pool, before pagination — server-side only. */
  pool: MediaTitle[];
}

/**
 * Filter, sort and paginate the collection.
 *
 * With a term the catalogue's own search answers; without one the cached
 * listing is the pool. If the search returns almost nothing for a term the
 * listing clearly contains, the listing's own text match fills the gap — a
 * keyword search that misses a title the catalogue holds is the bug this
 * section used to have.
 */
export async function searchExclusiveCatalogue(
  reader: CatalogueReader,
  options: ExclusiveSearchOptions = {}
): Promise<ExclusiveSearchResult> {
  const startedAt = Date.now();
  const kind: MediaKind | "all" = options.kind ?? "all";
  const term = (options.q || "").trim();
  const sort: MediaSort = options.sort ?? "trending";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(60, Math.max(1, Math.floor(options.limit ?? EXCLUSIVE_PAGE_SIZE)));

  let pool: MediaTitle[];
  if (term) {
    const searched = await reader.search(term, SEARCH_POOL_LIMIT);
    if (searched.length >= 10) {
      // The catalogue's own search answered well — no second read needed.
      pool = searched;
    } else {
      const listing = await reader.listing().catch(() => [] as MediaTitle[]);
      const fromListing = listing.filter((title) => matchesText(title, term));
      pool = dedupeTitles([...searched, ...fromListing]);
    }
  } else {
    pool = await reader.listing();
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
    provider: providerOf(reader),
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
export async function suggestExclusive(reader: CatalogueReader, query: string, limit = 8): Promise<ExclusiveSuggestions> {
  const startedAt = Date.now();
  const term = (query || "").trim();
  if (term.length < 2) return { query: term, items: [], tookMs: Date.now() - startedAt };

  let pool: MediaTitle[] = [];
  try {
    pool = await reader.listing();
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
      const searched = await reader.search(term, limit);
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
 * resource is also a perfectly good playback source — and on the direct path
 * it is often the *only* one, because the signed DASH manifest needs the
 * server's relay. MKV and archives stay download-only.
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

/** De-duplicates playback sources by URL, keeping the first (best) one. */
export function dedupePlayback(sources: PlaybackSource[]): PlaybackSource[] {
  const seen = new Set<string>();
  const out: PlaybackSource[] = [];
  for (const source of sources) {
    if (!source?.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
  }
  return out;
}

/**
 * One title with its own recommendations.
 *
 * The kind is inferred from the collection listing when it is not supplied (a
 * series opened through a movie URL used to load as a movie and come back
 * empty), then the reader's detail is used.
 */
export async function getExclusiveTitle(
  reader: CatalogueReader,
  slug: string,
  kind?: MediaKind
): Promise<ExclusiveTitleResponse | null> {
  const resolvedKind = kind ?? (await inferKind(reader, slug));
  const detail = await reader.detail(slug, resolvedKind);
  if (!detail) return null;

  let pool: MediaTitle[] = [];
  try {
    pool = await reader.listing();
  } catch {
    pool = [];
  }

  const recommendations = recommendTitles(detail.title, pool, 12);
  const playback = dedupePlayback([...(detail.playback ?? []), ...playableFromResources(detail)]);

  return {
    detail: { ...detail, playback, related: recommendations },
    recommendations,
    provider: providerOf(reader),
  };
}

async function inferKind(reader: CatalogueReader, slug: string): Promise<MediaKind> {
  try {
    const pool = await reader.listing();
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

/** Every genre the pool holds, most common first. */
export function genresOfPool(titles: readonly MediaTitle[], min = 2, limit = 12): Genre[] {
  const counts = new Map<string, { genre: Genre; count: number }>();
  for (const title of titles) {
    for (const genre of title.genres) {
      const entry = counts.get(genre.id);
      if (entry) entry.count += 1;
      else counts.set(genre.id, { genre, count: 1 });
    }
  }
  return [...counts.values()]
    .filter((entry) => entry.count >= min)
    .sort((a, b) => b.count - a.count || a.genre.name.localeCompare(b.genre.name))
    .slice(0, limit)
    .map((entry) => entry.genre);
}

/** Exposed for the tests and for callers that need the raw ranking score. */
export { rankScore };
