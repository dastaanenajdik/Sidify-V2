/**
 * Framework-free query maths for the media catalogue: search matching, filtering,
 * sorting, pagination, facets and "more like this".
 *
 * Kept dependency-free so it can be unit-tested with `node --test` (see
 * `tests/media.test.cjs`) and reused by any provider adapter.
 */

import type { MediaFacets, MediaKind, MediaPage, MediaQuery, MediaSort, MediaTitle } from "./types";

export const PAGE_SIZE = 24;

export const SORTS: { id: MediaSort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest" },
  { id: "rating", label: "Top rated" },
  { id: "oldest", label: "Oldest" },
  { id: "title", label: "A–Z" },
];

/** Normalise for matching: lower case, no diacritics, single spaces. */
export function normalize(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Does `title` match the free-text `query`? Matches title, genres, overview and year. */
export function matchesQuery(title: MediaTitle, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = [title.title, title.tagline, title.overview, title.languageName, title.year?.toString()]
    .concat(title.genres.map((g) => g.name))
    .join(" ");
  const hay = normalize(haystack);
  if (hay.includes(q)) return true;
  // Every word must appear somewhere, so "space 2024" still finds "Space ... 2024".
  return q.split(" ").every((word) => hay.includes(word));
}

/** `year` may be an exact year or a decade (`2020s`). */
export function matchesYear(year: number | undefined, filter: string | undefined): boolean {
  if (!filter) return true;
  if (!year) return false;
  const decade = filter.match(/^(\d{3})0s$/);
  if (decade) return year >= Number(`${decade[1]}0`) && year <= Number(`${decade[1]}9`);
  return Number(filter) === year;
}

export function filterTitles(items: MediaTitle[], query: MediaQuery): MediaTitle[] {
  const genre = query.genre?.trim();
  const language = query.language?.trim();
  const text = query.q?.trim();
  return items.filter((item) => {
    if (genre && !item.genres.some((g) => g.id === genre)) return false;
    if (language && item.language !== language) return false;
    if (!matchesYear(item.year, query.year)) return false;
    if (text && !matchesQuery(item, text)) return false;
    return true;
  });
}

export function sortTitles(items: MediaTitle[], sort: MediaSort = "trending"): MediaTitle[] {
  const byTitle = (a: MediaTitle, b: MediaTitle) => a.title.localeCompare(b.title);
  const out = [...items];
  switch (sort) {
    case "newest":
      return out.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.rating ?? 0) - (a.rating ?? 0) || byTitle(a, b));
    case "oldest":
      return out.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || byTitle(a, b));
    case "rating":
      return out.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0) || byTitle(a, b));
    case "title":
      return out.sort(byTitle);
    default:
      return out.sort(
        (a, b) =>
          (b.popularity ?? 0) - (a.popularity ?? 0) ||
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (b.year ?? 0) - (a.year ?? 0)
      );
  }
}

/** Filter → sort → paginate, in that order. */
export function queryTitles(items: MediaTitle[], query: MediaQuery, pageSize = PAGE_SIZE): MediaPage {
  const matched = sortTitles(filterTitles(items, query), query.sort);
  const totalResults = matched.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const page = Math.min(Math.max(1, Math.floor(query.page || 1)), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: matched.slice(start, start + pageSize),
    page,
    totalPages,
    totalResults,
    pageSize,
  };
}

export function buildFacets(items: MediaTitle[]): MediaFacets {
  const genres = new Map<string, string>();
  const languages = new Map<string, string>();
  const years = new Set<number>();
  for (const item of items) {
    for (const genre of item.genres) if (!genres.has(genre.id)) genres.set(genre.id, genre.name);
    if (item.language) languages.set(item.language, item.languageName || item.language.toUpperCase());
    if (item.year) years.add(item.year);
  }
  return {
    genres: [...genres.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    years: [...years].sort((a, b) => b - a),
    languages: [...languages.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Sort mixed year/decade filter options newest first. */
export function yearOrder(value: number | string): number {
  const match = String(value).match(/^(\d{4})/);
  return match ? Number(match[1]) : 0;
}

/** Rails worth showing on an unfiltered browse page. */
export function railsFor(
  kind: MediaKind,
  input: { trending: MediaTitle[]; recent: MediaTitle[]; topRated: MediaTitle[]; popular: MediaTitle[] }
) {
  const noun = kind === "movie" ? "films" : "series";
  return [
    { id: "trending", title: "Trending now", subtitle: `What everyone is watching`, items: input.trending },
    { id: "recent", title: kind === "movie" ? "New releases" : "New seasons", items: input.recent },
    { id: "top", title: "Critically acclaimed", subtitle: `Highest rated ${noun}`, items: input.topRated },
    { id: "popular", title: kind === "movie" ? "Popular films" : "Popular series", items: input.popular },
  ].filter((rail) => rail.items.length > 0);
}

/**
 * "More like this": shared genres weigh most, then same language, then a close year.
 * Deterministic, so the same title always recommends the same neighbours.
 */
export function relatedTitles(items: MediaTitle[], target: MediaTitle, limit = 12): MediaTitle[] {
  const genres = new Set(target.genres.map((g) => g.id));
  return items
    .filter((item) => item.slug !== target.slug || item.kind !== target.kind)
    .map((item) => {
      let score = 0;
      for (const genre of item.genres) if (genres.has(genre.id)) score += 3;
      if (item.language === target.language) score += 1.5;
      if (item.year && target.year) score += Math.max(0, 2 - Math.abs(item.year - target.year) / 4);
      score += (item.rating ?? 0) / 20;
      return { item, score };
    })
    .filter((row) => row.score > 2)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((row) => row.item);
}

/* ------------------------------- slugs ----------------------------------- */

export function slugify(text: string): string {
  return normalize(text).replace(/\s+/g, "-") || "untitled";
}

/** Build a provider-safe slug that starts with the numeric provider id. */
export function mediaSlug(id: string | number, title: string): string {
  return `${id}-${slugify(title)}`;
}

/** Pull the provider id out of a slug (`603692-john-wick` → `603692`). */
export function idFromSlug(slug: string): string {
  const match = decodeURIComponent(slug).match(/^(\d+)(?:-|$)/);
  return match ? match[1] : decodeURIComponent(slug);
}

/** Human-readable title from a slug, for metadata fallbacks. */
export function titleFromSlug(slug: string): string {
  const clean = decodeURIComponent(slug).replace(/^\d+-?/, "").replace(/-/g, " ").trim();
  return clean.replace(/\b\w/g, (c) => c.toUpperCase());
}
