/**
 * Catalogue ranking, filtering and recommendations.
 *
 * Framework-free on purpose: the same functions rank the exclusive landing
 * page, filter its search results, and pick "more like this" on a detail page.
 * Keeping them here (instead of inside a provider) means the Node test runner
 * can exercise every rule without a network call or a React render.
 *
 * The rules are deliberately explainable — no hidden weights:
 *
 *   rankScore  = rating (0–10)  × 3
 *              + popularity    (0–1,  normalised)
 *              + freshness     (0–1,  decays over 6 years)
 *              + votes bonus   (log-scaled, capped)
 *
 * A title with no rating is not penalised to zero: it scores on popularity and
 * freshness alone, so a brand-new release can still appear in "New releases".
 */

import { qualityRank } from "./playbackPlan";
import type { Genre, Language, MediaFacets, MediaKind, MediaSort, MediaTitle } from "./types";

/** An empty facet set — handy as a render fallback before data arrives. */
export const EMPTY_FACETS: MediaFacets = { genres: [], years: [], languages: [] };

/** Stable identity of a title across the two catalogues. */
export function titleKey(title: Pick<MediaTitle, "kind" | "slug">): string {
  return `${title.kind}:${title.slug}`;
}

/** De-duplicate by slug — providers occasionally return the same subject twice. */
export function dedupeTitles(titles: readonly MediaTitle[]): MediaTitle[] {
  const seen = new Set<string>();
  const out: MediaTitle[] = [];
  for (const title of titles) {
    if (!title?.slug) continue;
    const key = titleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

/** The four-digit year of a title, or `null`. */
export function numericYear(title: Pick<MediaTitle, "year" | "releaseDate">): number | null {
  if (typeof title.year === "number" && Number.isFinite(title.year)) return title.year;
  const match = String(title.releaseDate || "").match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2099 ? year : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Popularity as 0–1.
 *
 * Catalogues report it as a browse rank, a view count or a "hot" score, so a
 * raw value cannot be compared across titles. Using the catalogue's own
 * min/max gives a stable relative order without assuming a scale.
 */
export function normalisePopularity(titles: readonly MediaTitle[]): (title: MediaTitle) => number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const title of titles) {
    const value = title.popularity;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min;
  return (title) => {
    const value = title.popularity;
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return span > 0 ? clamp01((value - min) / span) : 0.5;
  };
}

/** 1 for a release this year, decaying to 0 at six years old. */
export function freshness(title: Pick<MediaTitle, "year" | "releaseDate">, now = new Date().getFullYear()): number {
  const year = numericYear(title);
  if (!year) return 0;
  const age = Math.max(0, now - year);
  return clamp01(1 - age / 6);
}

/**
 * Ranking score. Higher is better.
 *
 * `popularityOf` comes from `normalisePopularity(pool)` so the score means the
 * same thing for every title in the same listing.
 */
export function rankScore(
  title: MediaTitle,
  popularityOf: (title: MediaTitle) => number = () => 0,
  now = new Date().getFullYear()
): number {
  const rating = typeof title.rating === "number" && title.rating > 0 ? Math.min(10, title.rating) : 0;
  const votes = typeof title.votes === "number" && title.votes > 0 ? Math.log10(1 + title.votes) / 5 : 0;
  return clamp01(rating / 10) * 3 + popularityOf(title) + freshness(title, now) + clamp01(votes);
}

/** Rank a whole pool by `rankScore`, keeping the pool's own popularity scale. */
export function rankTitles(titles: readonly MediaTitle[], now = new Date().getFullYear()): MediaTitle[] {
  const popularityOf = normalisePopularity(titles);
  return titles
    .map((title, index) => ({ title, index, score: rankScore(title, popularityOf, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.title);
}

/** Sort a page with an explicit user-visible sort. */
export function sortTitles(titles: readonly MediaTitle[], sort: MediaSort = "trending", now = new Date().getFullYear()): MediaTitle[] {
  const copy = [...titles];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => (numericYear(b) ?? 0) - (numericYear(a) ?? 0) || a.title.localeCompare(b.title));
    case "oldest":
      return copy.sort((a, b) => (numericYear(a) ?? 9999) - (numericYear(b) ?? 9999) || a.title.localeCompare(b.title));
    case "rating":
      return copy.sort(
        (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0) || a.title.localeCompare(b.title)
      );
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "trending":
    default:
      return rankTitles(copy, now);
  }
}

/** Whether a title matches a year filter — an exact year ("2024") or a decade ("2020s"). */
export function matchesYear(title: Pick<MediaTitle, "year" | "releaseDate">, filter: string | undefined): boolean {
  if (!filter) return true;
  const year = numericYear(title);
  if (!year) return false;
  const decade = filter.trim().match(/^(\d{3})0s$/);
  if (decade) {
    const start = Number(`${decade[1]}0`);
    return year >= start && year < start + 10;
  }
  return String(year) === filter.trim();
}

/** Whether a title matches a genre id ("science-fiction") or its display name. */
export function matchesGenre(title: Pick<MediaTitle, "genres">, filter: string | undefined): boolean {
  if (!filter) return true;
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return title.genres.some(
    (genre) => genre.id.toLowerCase() === needle || genre.name.toLowerCase() === needle
  );
}

function languageCandidates(title: Pick<MediaTitle, "language" | "languageName">): string[] {
  return [title.language, title.languageName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

/** Whether a title matches a language code ("hi") or a display name ("Hindi"). */
export function matchesLanguage(title: Pick<MediaTitle, "language" | "languageName">, filter: string | undefined): boolean {
  if (!filter) return true;
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return languageCandidates(title).includes(needle);
}

/** A free-text match over the title (weighted) and its genres (lighter). */
export function matchesText(title: Pick<MediaTitle, "title" | "overview" | "genres">, term: string | undefined): boolean {
  const needle = (term || "").trim().toLowerCase();
  if (!needle) return true;
  if (title.title.toLowerCase().includes(needle)) return true;
  if (title.genres.some((genre) => genre.name.toLowerCase().includes(needle))) return true;
  return title.overview?.toLowerCase().includes(needle) ?? false;
}

export interface TitleFilter {
  kind?: MediaKind | "all";
  genre?: string;
  year?: string;
  language?: string;
  q?: string;
}

/** Apply every catalogue filter at once. An empty filter is a no-op. */
export function filterTitles(titles: readonly MediaTitle[], filter: TitleFilter): MediaTitle[] {
  const kind = filter.kind && filter.kind !== "all" ? filter.kind : null;
  return titles.filter(
    (title) =>
      (!kind || title.kind === kind) &&
      matchesGenre(title, filter.genre) &&
      matchesYear(title, filter.year) &&
      matchesLanguage(title, filter.language) &&
      matchesText(title, filter.q)
  );
}

/**
 * Similarity between two titles, 0–10.
 *
 * Shared genres dominate (that is what "more like this" means), then the same
 * kind, the same language, and a release within three years.
 */
export function similarity(seed: Pick<MediaTitle, "kind" | "genres" | "language" | "year" | "releaseDate">, candidate: MediaTitle): number {
  const seedGenres = new Set(seed.genres.map((genre) => genre.id));
  let shared = 0;
  for (const genre of candidate.genres) {
    if (seedGenres.has(genre.id)) shared += 1;
  }
  if (shared === 0 && candidate.kind !== seed.kind) return 0;

  let score = Math.min(6, shared * 2);
  if (candidate.kind === seed.kind) score += 1;
  if (candidate.language && candidate.language === seed.language) score += 1;

  const seedYear = numericYear(seed);
  const candidateYear = numericYear(candidate);
  if (seedYear && candidateYear && Math.abs(seedYear - candidateYear) <= 3) score += 1;

  // Rating deliberately does not add score here: a well-reviewed title in an
  // unrelated genre is not "more like this". It is only a tie-break, below.
  return Math.min(10, score);
}

/**
 * "More like this": the seed's own catalogue neighbours, best match first.
 *
 * Ties break on rating and then on the catalogue's order, so the rail is stable
 * between requests (important for caching and for "the page changed" bug reports).
 */
export function recommendTitles(
  seed: MediaTitle,
  pool: readonly MediaTitle[],
  limit = 12
): MediaTitle[] {
  const seedKey = titleKey(seed);
  return pool
    .filter((candidate) => titleKey(candidate) !== seedKey)
    .map((candidate, index) => ({ candidate, index, score: similarity(seed, candidate) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.candidate.rating ?? 0) - (a.candidate.rating ?? 0) ||
        a.index - b.index
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.candidate);
}

/** Titles with a rating at or above `min`, best first. */
export function highlyRated(titles: readonly MediaTitle[], min = 7.5, limit = 12): MediaTitle[] {
  return titles
    .filter((title) => typeof title.rating === "number" && title.rating >= min)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.votes ?? 0) - (a.votes ?? 0))
    .slice(0, limit);
}

/** The newest titles, by year then catalogue order. */
export function newestTitles(titles: readonly MediaTitle[], limit = 12): MediaTitle[] {
  return [...titles]
    .map((title, index) => ({ title, index, year: numericYear(title) ?? 0 }))
    .sort((a, b) => b.year - a.year || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.title);
}

/** Highest advertised encode across releases, or undefined. */
export function bestQualityOf(releases: readonly { quality?: string }[] | undefined): string | undefined {
  if (!releases?.length) return undefined;
  let best: string | undefined;
  for (const release of releases) {
    if (!release.quality) continue;
    if (!best || qualityRank(release.quality) > qualityRank(best)) best = release.quality;
  }
  return best;
}

/** Genres present in a pool, de-duplicated and alphabetised. */
export function genresFromTitles(titles: readonly MediaTitle[]): Genre[] {
  const map = new Map<string, Genre>();
  for (const title of titles) {
    for (const genre of title.genres) {
      if (!genre?.id || map.has(genre.id)) continue;
      map.set(genre.id, genre);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Years present in a pool, newest first, plus decade buckets for older titles. */
export function yearsFromTitles(titles: readonly MediaTitle[]): (number | string)[] {
  const years = new Set<number>();
  for (const title of titles) {
    const year = numericYear(title);
    if (year) years.add(year);
  }
  const newest = new Date().getFullYear();
  const out: (number | string)[] = [...years].sort((a, b) => b - a);
  const oldest = Math.min(...years, newest);
  if (Number.isFinite(oldest)) {
    for (let decade = Math.floor(newest / 10) * 10; decade >= Math.floor(oldest / 10) * 10; decade -= 10) {
      out.push(`${decade}s`);
    }
  }
  return out;
}

/** Languages present in a pool, de-duplicated, alphabetical by display name. */
export function languagesFromTitles(titles: readonly MediaTitle[]): Language[] {
  const map = new Map<string, Language>();
  for (const title of titles) {
    const code = (title.language || "").trim().toLowerCase();
    if (!code || map.has(code)) continue;
    map.set(code, { code, name: title.languageName?.trim() || code.toUpperCase() });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Genres in a pool that hold at least `min` titles, most common first. */
export function popularGenres(titles: readonly MediaTitle[], min = 2, limit = 12): Genre[] {
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
