/**
 * Video (movies & series) models.
 *
 * These types are shared by every media provider adapter (`src/lib/media/*Provider.ts`),
 * the `/api/media/*` routes and the UI. Nothing here is music-specific: the music
 * catalogue keeps using `src/lib/types.ts`.
 */

export type MediaKind = "movie" | "series";

export interface Genre {
  /** Provider genre id as a string, e.g. "18" (TMDb drama) or "drama" (catalogue). */
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
 * A browser-playable stream source. Non-stream containers such as `.mkv` or `.zip`
 * must NOT be represented as `PlaybackSource` — represent them as downloads or
 * `ResolvedMirrorLink` entries with `playable: false`.
 */
export interface PlaybackSource {
  url: string;
  /**
   * `hls` for `.m3u8`, `dash` for `.mpd`, `mp4` / `webm` for progressive
   * browser-compatible files, `embed` for an official third-party player rendered in
   * an iframe.
   */
  type: "hls" | "dash" | "mp4" | "webm" | "embed";
  label?: string;
  /** Short caveat or technical note shown under the player. */
  note?: string;
  /** Container hint used to pick the right MIME type for the player. */
  container?: string;
}

/** A download offered for a title or item. */
export interface MediaDownload {
  label: string;
  url: string;
  /** `page` for a download-options page, `file` for a direct file. */
  kind: "page" | "file";
  format?: string;
  sizeBytes?: number;
}

/** Public mirror short-link attached to a specific release quality or episode. */
export interface MediaMirror {
  id: string;
  label: string;
  shortUrl: string;
  host: string;
  /**
   * Which catalogue the mirror came from. The resolver routes on this instead of
   * guessing from the URL, so a direct file from the exclusive catalogue is never
   * mistaken for a multi-hop mirror of another catalogue.
   */
  source?: "vault";
  /**
   * Request headers the upstream needs (e.g. a signed CDN cookie). They are relayed
   * server-side; a browser cannot set `Cookie` on a cross-origin request.
   */
  headers?: Array<[string, string]>;
}

/** A parsed release quality, season pack, or episode encode with mirror short-links. */
export interface MediaReleaseItem {
  id: string;
  title: string;
  fileName: string;
  quality?: string;
  size?: string;
  sizeBytes?: number;
  container?: string;
  languages?: string;
  tags?: string[];
  /** True for archive packs (`.zip`, `.rar`, `.7z`) that cannot play directly. */
  isPack?: boolean;
  seasonGroup?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  mirrors: MediaMirror[];
}

export type MirrorHopStatus = "ok" | "redirect" | "blocked" | "error";

export type MirrorBlockReason =
  | "captcha"
  | "access_control"
  | "disallowed_host"
  | "blocked_ip"
  | "insecure_protocol"
  | "timeout"
  | "response_too_large"
  | "malformed_response"
  | "network_error";

export interface MirrorHop {
  step: string;
  host: string;
  status: MirrorHopStatus;
  httpStatus?: number;
  reason?: MirrorBlockReason;
  detail?: string;
}

export interface ResolvedMirrorLink {
  server: string;
  url: string;
  /** True ONLY when verified as a browser-compatible stream (`mp4`, `webm`, `hls`, `dash`). */
  playable: boolean;
  streamType?: "hls" | "dash" | "mp4" | "webm";
  delivery: "stream" | "download" | "external";
  container?: string;
  codecNote?: string;
  unsupportedReason?: string;
}

export interface MirrorResolveResult {
  status: "resolved" | "partial" | "blocked" | "error";
  links: ResolvedMirrorLink[];
  externalFallbackUrl?: string;
  reason?: MirrorBlockReason;
  message?: string;
  hops: MirrorHop[];
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
  /** True for freely available titles that stream without a subscription. */
  free?: boolean;
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
  size?: string;
  releases?: MediaReleaseItem[];
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
  /** Browser-compatible streams only; empty when none are verified. */
  playback: PlaybackSource[];
  /** Downloads offered directly by the provider. */
  downloads?: MediaDownload[];
  /** Available quality encodes, season packs and mirror short-links. */
  releases?: MediaReleaseItem[];
  provider: ProviderInfo;
  attribution?: string;
}

export interface MediaSearchResponse {
  query: string;
  items: MediaTitle[];
  provider: ProviderInfo;
}
