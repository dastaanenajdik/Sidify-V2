/**
 * Video (movies & series) models.
 *
 * These types are shared by every media provider adapter (`src/lib/media/*Provider.ts`),
 * the `/api/media/*` routes and the UI. Nothing here is music-specific: the music
 * catalogue keeps using `src/lib/types.ts`.
 */

export type MediaKind = "movie" | "series";

export interface Genre {
  /** Provider genre id as a string, e.g. "18" (TMDb drama) or "drama" (demo). */
  id: string;
  name: string;
}

export interface Language {
  /** ISO-639-1 code, e.g. "en", "hi", "ja". */
  code: string;
  name: string;
}

/** An official trailer. Only ever YouTube keys supplied by the provider. */
export interface TrailerRef {
  site: "youtube";
  key: string;
  name: string;
  official?: boolean;
}

/**
 * An authorized playback source — a URL the operator/licensed provider is allowed
 * to stream. Providers that do not license playback return an empty list.
 */
export interface PlaybackSource {
  url: string;
  /** `hls` for `.m3u8`, `mp4` for progressive files. */
  type: "hls" | "mp4";
  label?: string;
}

/** Official availability / "where to watch" page supplied by the provider. */
export interface WatchProviderLink {
  name: string;
  url: string;
  kind?: "stream" | "rent" | "buy" | "free";
}

export interface MediaTitle {
  id: string;
  /** URL segment: `<providerId>-<slug>` for real providers, plain slug for demo. */
  slug: string;
  kind: MediaKind;
  title: string;
  tagline?: string;
  overview: string;
  year?: number;
  /** ISO date of first release / first air date. */
  releaseDate?: string;
  genres: Genre[];
  /** Primary original language (ISO-639-1). */
  language: string;
  languageName?: string;
  /** 0–10, provider average. */
  rating?: number;
  votes?: number;
  /** Movie runtime, or average episode runtime for a series. */
  runtimeMinutes?: number;
  certification?: string;
  /** Absolute poster URL (2:3). Missing → the UI draws deterministic art. */
  poster?: string | null;
  /** Absolute backdrop URL (16:9). */
  backdrop?: string | null;
  /** Fallback art hue used when no poster URL exists. */
  accent?: string;
  trailer?: TrailerRef | null;
  seasonCount?: number;
  episodeCount?: number;
  status?: string;
  popularity?: number;
  officialUrl?: string | null;
  watchProviders?: WatchProviderLink[];
  /** True for catalogue entries that are placeholder data, not a real title. */
  demo?: boolean;
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  runtimeMinutes?: number;
  airDate?: string;
  still?: string | null;
  rating?: number;
}

export interface Season {
  id: string;
  seasonNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  poster?: string | null;
  episodes: Episode[];
}

export type MediaSort = "trending" | "newest" | "oldest" | "rating" | "title";

export interface MediaQuery {
  q?: string;
  /** Genre id. */
  genre?: string;
  /** A single year ("2024") or a decade ("2020s"). */
  year?: string;
  /** ISO-639-1 language code. */
  language?: string;
  sort?: MediaSort;
  page?: number;
}

export interface MediaFacets {
  genres: Genre[];
  /** Filter options: exact years (2024) and/or decades ("2020s"), newest first. */
  years: (number | string)[];
  languages: Language[];
}

export interface MediaPage {
  items: MediaTitle[];
  page: number;
  totalPages: number;
  totalResults: number;
  pageSize: number;
}

export interface MediaRail {
  id: string;
  title: string;
  subtitle?: string;
  items: MediaTitle[];
}

/** Which adapter answered, so the UI can badge demo content and show attribution. */
export interface ProviderInfo {
  id: "demo" | "tmdb" | string;
  label: string;
  /** Legally required credit for a real provider (TMDb's own wording). */
  attribution?: string;
  demo: boolean;
}

export interface MediaBrowse extends MediaPage {
  kind: MediaKind;
  featured: MediaTitle | null;
  rails: MediaRail[];
  facets: MediaFacets;
  provider: ProviderInfo;
  /** True when a search/filter is applied, so rails are not shown. */
  filtered: boolean;
}

export interface MediaDetail {
  title: MediaTitle;
  /** Empty for movies. */
  seasons: Season[];
  related: MediaTitle[];
  /** Only authorized URLs; empty when no licensed playback is configured. */
  playback: PlaybackSource[];
  provider: ProviderInfo;
  attribution?: string;
}

export interface MediaSearchResponse {
  query: string;
  items: MediaTitle[];
  provider: ProviderInfo;
}
