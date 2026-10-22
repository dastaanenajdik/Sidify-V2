/**
 * TMDb adapter — the official (keyed) metadata API.
 *
 * TMDb is a metadata catalogue: it supplies titles, artwork, trailers and official
 * "where to watch" links (via JustWatch), but it does **not** license streaming. This
 * adapter therefore never returns a playback URL; `getPlaybackSources` stays empty so
 * the UI shows the official trailer / availability card instead of a fake player.
 *
 * Required env (either one):
 *   TMDB_READ_ACCESS_TOKEN  – v4 read access token (Bearer), preferred
 *   TMDB_API_KEY            – v3 api key
 * Optional:
 *   TMDB_LANGUAGE           – default "en-US"
 *   TMDB_REGION             – default "IN" (watch-provider availability region)
 *
 * Terms: attribution is required — see `ATTRIBUTION` below, which the UI renders.
 */

import type { MediaProvider } from "./provider";
import { MediaProviderError } from "./provider";
import { justWatchSearchUrl } from "./availability";
import { filterTitles, idFromSlug, mediaSlug, sortTitles } from "./query";
import type {
  Episode,
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
  TrailerRef,
  WatchProviderLink,
} from "./types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
/** Language filter options for the TMDb adapter (ISO-639-1). */
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "bn", name: "Bengali" },
  { code: "mr", name: "Marathi" },
  { code: "ml", name: "Malayalam" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "ru", name: "Russian" },
  { code: "tr", name: "Turkish" },
];

export const ATTRIBUTION = "This product uses the TMDB API but is not endorsed or certified by TMDB.";

export const TMDB_PROVIDER_INFO: ProviderInfo = {
  id: "tmdb",
  label: "TMDB",
  attribution: ATTRIBUTION,
  demo: false,
};

/* --------------------------------- types --------------------------------- */

interface TmdbTitle {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  overview?: string;
  tagline?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  status?: string;
  media_type?: string;
  adult?: boolean;
  videos?: { results?: TmdbVideo[] };
  recommendations?: { results?: TmdbTitle[] };
  seasons?: TmdbSeason[];
  "watch/providers"?: { results?: Record<string, TmdbProviderRegion | undefined> };
}

interface TmdbVideo {
  key?: string;
  site?: string;
  type?: string;
  name?: string;
  official?: boolean;
}

interface TmdbSeason {
  id?: number;
  season_number?: number;
  name?: string;
  overview?: string;
  air_date?: string | null;
  episode_count?: number;
  poster_path?: string | null;
}

interface TmdbEpisode {
  id?: number;
  season_number?: number;
  episode_number?: number;
  name?: string;
  overview?: string;
  runtime?: number | null;
  air_date?: string | null;
  still_path?: string | null;
  vote_average?: number;
}

interface TmdbProviderRegion {
  link?: string;
  flatrate?: { provider_name?: string }[];
  free?: { provider_name?: string }[];
  rent?: { provider_name?: string }[];
  buy?: { provider_name?: string }[];
}

interface TmdbList<T> {
  page?: number;
  results?: T[];
  total_pages?: number;
  total_results?: number;
}

export function tmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_API_KEY);
}

/* ------------------------------- transport -------------------------------- */

function settings() {
  return {
    token: process.env.TMDB_READ_ACCESS_TOKEN || "",
    key: process.env.TMDB_API_KEY || "",
    language: process.env.TMDB_LANGUAGE || "en-US",
    region: process.env.TMDB_REGION || "IN",
  };
}

async function tmdb<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, revalidate = 3600): Promise<T> {
  const { token, key, language } = settings();
  if (!token && !key) throw new MediaProviderError("TMDB credentials are not configured", 501, "tmdb");

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("language", language);
  if (!token && key) url.searchParams.set("api_key", key);
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) continue;
    url.searchParams.set(name, String(value));
  }

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}`, accept: "application/json" } : { accept: "application/json" },
    // Catalogue metadata changes slowly; cache it at the fetch layer.
    next: { revalidate },
  });

  if (!res.ok) {
    const status = res.status === 404 ? 404 : 502;
    throw new MediaProviderError(`TMDB request failed (${res.status}) for ${path}`, status, "tmdb");
  }
  return (await res.json()) as T;
}

/* -------------------------------- mapping -------------------------------- */

const image = (path: string | null | undefined, size: string): string | null => (path ? `${IMG}/${size}${path}` : null);

const yearOf = (date?: string | null): number | undefined => {
  const year = date?.match(/^\d{4}/)?.[0];
  return year ? Number(year) : undefined;
};

/** TMDb credential-free poster fallback stays null; the UI draws generated art. */
function baseTitle(raw: TmdbTitle, kind: MediaKind, genres: Genre[]): MediaTitle {
  const title = raw.title || raw.name || raw.original_title || raw.original_name || "Untitled";
  return {
    id: String(raw.id),
    slug: mediaSlug(raw.id, title),
    kind,
    title,
    tagline: raw.tagline || undefined,
    overview: raw.overview || "",
    year: yearOf(raw.release_date || raw.first_air_date),
    releaseDate: raw.release_date || raw.first_air_date || undefined,
    genres,
    language: raw.original_language || "en",
    languageName: raw.original_language ? raw.original_language.toUpperCase() : undefined,
    rating: typeof raw.vote_average === "number" ? Math.round(raw.vote_average * 10) / 10 : undefined,
    votes: raw.vote_count,
    runtimeMinutes: raw.runtime || raw.episode_run_time?.[0] || undefined,
    poster: image(raw.poster_path, "w500"),
    backdrop: image(raw.backdrop_path, "w1280"),
    trailer: trailerOf(raw.videos?.results),
    seasonCount: raw.number_of_seasons,
    episodeCount: raw.number_of_episodes,
    status: raw.status,
    popularity: raw.popularity,
    watchProviders: watchProvidersOf(
      raw["watch/providers"]?.results?.[settings().region],
      title,
      yearOf(raw.release_date || raw.first_air_date),
      settings().region
    ),
    demo: false,
  };
}

function trailerOf(videos?: TmdbVideo[]): TrailerRef | null {
  const trailers = (videos || []).filter((v) => v.site === "YouTube" && v.key && (v.type === "Trailer" || v.type === "Teaser"));
  const pick = trailers.find((v) => v.official && v.type === "Trailer") || trailers.find((v) => v.type === "Trailer") || trailers[0];
  if (!pick?.key) return null;
  return { site: "youtube", key: pick.key, name: pick.name || "Official trailer", official: pick.official };
}

function watchProvidersOf(
  region: TmdbProviderRegion | undefined,
  title: string,
  year: number | undefined,
  country: string
): WatchProviderLink[] {
  const out: WatchProviderLink[] = [];
  if (region?.link) {
    const push = (list: { provider_name?: string }[] | undefined, kind: WatchProviderLink["kind"]) => {
      for (const provider of list || []) {
        if (!provider.provider_name) continue;
        if (out.some((entry) => entry.name === provider.provider_name)) continue;
        out.push({ name: provider.provider_name, url: region.link!, kind });
      }
    };
    push(region.flatrate, "stream");
    push(region.free, "free");
    push(region.rent, "rent");
    push(region.buy, "buy");
  }

  // TMDb may have no provider row for a title/region. Keep a lawful discovery
  // path available instead of leaving the detail page with no next step.
  if (out.length === 0) {
    out.push({ name: "Find where to watch", url: justWatchSearchUrl(title, year, country) });
  }
  return out.slice(0, 6);
}

function seasonOf(raw: TmdbSeason): Season {
  return {
    id: String(raw.id ?? `s${raw.season_number}`),
    seasonNumber: raw.season_number ?? 1,
    name: raw.name || `Season ${raw.season_number ?? 1}`,
    overview: raw.overview || undefined,
    airDate: raw.air_date || undefined,
    poster: image(raw.poster_path, "w342"),
    episodes: [],
  };
}

function episodeOf(raw: TmdbEpisode): Episode {
  return {
    id: String(raw.id ?? `s${raw.season_number}e${raw.episode_number}`),
    seasonNumber: raw.season_number ?? 1,
    episodeNumber: raw.episode_number ?? 1,
    title: raw.name || `Episode ${raw.episode_number ?? 1}`,
    overview: raw.overview || undefined,
    runtimeMinutes: raw.runtime || undefined,
    airDate: raw.air_date || undefined,
    still: image(raw.still_path, "w300"),
    rating: raw.vote_average ? Math.round(raw.vote_average * 10) / 10 : undefined,
  };
}

/* -------------------------------- adapter -------------------------------- */

export class TmdbMediaProvider implements MediaProvider {
  readonly info = TMDB_PROVIDER_INFO;

  /** Genre lists change rarely; keep them per process. */
  private genreCache: Partial<Record<MediaKind, { id: number; name: string }[]>> = {};

  private async genreList(kind: MediaKind): Promise<{ id: number; name: string }[]> {
    const cached = this.genreCache[kind];
    if (cached) return cached;
    const data = await tmdb<{ genres?: { id: number; name: string }[] }>(`/genre/${kind === "movie" ? "movie" : "tv"}/list`, {}, 86_400);
    const genres = data.genres || [];
    this.genreCache[kind] = genres.map((g) => ({ id: g.id, name: g.name }));
    return genres;
  }

  private async mapTitles(raw: TmdbTitle[], kind: MediaKind): Promise<MediaTitle[]> {
    const genres = await this.genreList(kind);
    const byId = new Map(genres.map((g) => [String(g.id), g.name]));
    return raw.map((item) => baseTitle({ ...item, genres: undefined }, kind, genreIdsToGenres(item.genre_ids, byId)));
  }

  private async list(path: string, kind: MediaKind, params: Record<string, string | number | boolean | undefined>, limit = 20): Promise<MediaTitle[]> {
    const data = await tmdb<TmdbList<TmdbTitle>>(path, params);
    const titles = await this.mapTitles((data.results || []).filter((t) => !t.adult), kind);
    return titles.slice(0, limit);
  }

  getTrendingMovies(limit = 20) {
    return this.list("/trending/movie/week", "movie", {}, limit);
  }
  getTrendingSeries(limit = 20) {
    return this.list("/trending/tv/week", "series", {}, limit);
  }
  getPopularMovies(limit = 20) {
    return this.list("/movie/popular", "movie", {}, limit);
  }
  getPopularSeries(limit = 20) {
    return this.list("/tv/popular", "series", {}, limit);
  }
  getNewMovieReleases(limit = 20) {
    return this.list("/movie/now_playing", "movie", { region: settings().region }, limit);
  }
  getNewSeriesReleases(limit = 20) {
    return this.list("/tv/on_the_air", "series", {}, limit);
  }
  getTopRatedMovies(limit = 20) {
    return this.list("/movie/top_rated", "movie", {}, limit);
  }
  getTopRatedSeries(limit = 20) {
    return this.list("/tv/top_rated", "series", {}, limit);
  }

  private sortParam(kind: MediaKind, sort: MediaQuery["sort"]): Record<string, string | number> {
    const nameField = kind === "movie" ? "original_title" : "name";
    const dateField = kind === "movie" ? "primary_release_date" : "first_air_date";
    switch (sort) {
      case "newest":
        return { sort_by: `${dateField}.desc` };
      case "oldest":
        return { sort_by: `${dateField}.asc` };
      case "rating":
        return { sort_by: "vote_average.desc", "vote_count.gte": 100 };
      case "title":
        return { sort_by: `${nameField}.asc` };
      default:
        return { sort_by: "popularity.desc" };
    }
  }

  async browse(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
    const page = Math.max(1, Math.floor(query.page || 1));
    const pageSize = query.q ? 20 : 20;

    if (query.q?.trim()) {
      const data = await tmdb<TmdbList<TmdbTitle>>(`/search/${kind === "movie" ? "movie" : "tv"}`, {
        query: query.q.trim(),
        page,
        include_adult: false,
      });
      const mapped = await this.mapTitles((data.results || []).filter((t) => !t.adult), kind);
      const filtered = filterTitles(mapped, { ...query, q: undefined });
      return {
        items: query.sort && query.sort !== "trending" ? sortTitles(filtered, query.sort) : filtered,
        page,
        totalPages: data.total_pages || 1,
        totalResults: data.total_results || filtered.length,
        pageSize,
      };
    }

    const params: Record<string, string | number> = {
      page,
      include_adult: "false",
      ...this.sortParam(kind, query.sort),
    };
    if (query.genre) params.with_genres = query.genre;
    if (query.language) params.with_original_language = query.language;
    const decade = query.year?.match(/^(\d{3})0s$/);
    const dateField = kind === "movie" ? "primary_release_date" : "first_air_date";
    if (decade) {
      params[`${dateField}.gte`] = `${decade[1]}0-01-01`;
      params[`${dateField}.lte`] = `${decade[1]}9-12-31`;
    } else if (query.year) {
      params[kind === "movie" ? "primary_release_year" : "first_air_date_year"] = Number(query.year);
    }

    const data = await tmdb<TmdbList<TmdbTitle>>(`/discover/${kind === "movie" ? "movie" : "tv"}`, params);
    return {
      items: await this.mapTitles((data.results || []).filter((t) => !t.adult), kind),
      page,
      totalPages: Math.min(data.total_pages || 1, 500),
      totalResults: data.total_results || 0,
      pageSize,
    };
  }

  async searchTitles(query: string, kind: MediaKind | "all" = "all", limit = 20): Promise<MediaTitle[]> {
    if (!query.trim()) return [];
    const data = await tmdb<TmdbList<TmdbTitle>>("/search/multi", { query: query.trim(), include_adult: false, page: 1 });
    const results = (data.results || []).filter((t) => !t.adult && (t.media_type === "movie" || t.media_type === "tv"));
    const movies = await this.mapTitles(results.filter((t) => t.media_type === "movie"), "movie");
    const series = await this.mapTitles(results.filter((t) => t.media_type === "tv"), "series");
    const merged = kind === "movie" ? movies : kind === "series" ? series : [...movies, ...series];
    return merged.slice(0, limit);
  }

  async getGenres(kind: MediaKind): Promise<Genre[]> {
    const genres = await this.genreList(kind);
    return genres.map((g) => ({ id: String(g.id), name: g.name }));
  }

  async getFacets(kind: MediaKind): Promise<MediaFacets> {
    const genres = await this.getGenres(kind);
    const current = new Date().getFullYear();
    const years: (number | string)[] = [];
    for (let year = current + 1; year >= current - 24; year--) years.push(year);
    for (let decade = Math.floor(current / 10) * 10; decade >= 1950; decade -= 10) years.push(`${decade}s`);
    return { genres, years, languages: LANGUAGES };
  }

  private async detail(kind: MediaKind, slug: string): Promise<MediaDetail | null> {
    const id = idFromSlug(slug);
    if (!/^\d+$/.test(id)) return null;
    const path = kind === "movie" ? `/movie/${id}` : `/tv/${id}`;
    let raw: TmdbTitle;
    try {
      raw = await tmdb<TmdbTitle>(path, { append_to_response: "videos,recommendations,watch/providers" }, 3600);
    } catch (error) {
      if (error instanceof MediaProviderError && error.status === 404) return null;
      throw error;
    }

    const genres = (raw.genres || []).map((g) => ({ id: String(g.id), name: g.name }));
    const title = baseTitle(raw, kind, genres);
    const related = kind === "movie" ? await this.mapTitles(raw.recommendations?.results || [], "movie") : await this.mapTitles(raw.recommendations?.results || [], "series");
    const seasons = kind === "series" ? (raw.seasons || []).filter((s) => (s.season_number ?? 0) >= 1).map(seasonOf) : [];

    return {
      title,
      seasons,
      related: related.slice(0, 12),
      playback: [],
      provider: this.info,
      attribution: ATTRIBUTION,
    };
  }

  getMovieDetails(slug: string) {
    return this.detail("movie", slug);
  }
  getSeriesDetails(slug: string) {
    return this.detail("series", slug);
  }

  async getSeriesSeasons(slug: string, seasonNumber?: number): Promise<Season[]> {
    const id = idFromSlug(slug);
    if (!/^\d+$/.test(id)) return [];
    const raw = await tmdb<TmdbTitle>(`/tv/${id}`, {}, 3600);
    const seasons = (raw.seasons || []).filter((s) => (s.season_number ?? 0) >= 1).map(seasonOf);
    if (seasonNumber === undefined) return seasons;

    const target = seasons.find((s) => s.seasonNumber === seasonNumber);
    if (!target) return [];
    const detail = await tmdb<{ episodes?: TmdbEpisode[]; overview?: string; air_date?: string | null; name?: string; poster_path?: string | null }>(
      `/tv/${id}/season/${seasonNumber}`,
      {},
      3600
    );
    return [
      {
        ...target,
        overview: detail.overview || target.overview,
        airDate: detail.air_date || target.airDate,
        poster: image(detail.poster_path, "w342") || target.poster,
        episodes: (detail.episodes || []).map(episodeOf),
      },
    ];
  }

  async getRelated(kind: MediaKind, slug: string, limit = 12): Promise<MediaTitle[]> {
    const detail = await this.detail(kind, slug);
    return detail ? detail.related.slice(0, limit) : [];
  }

  /**
   * TMDb licenses metadata, not streams. Authorized playback must come from an
   * operator-configured manifest or a licensed streaming provider — never from here.
   */
  async getPlaybackSources(): Promise<PlaybackSource[]> {
    return [];
  }
}

function genreIdsToGenres(ids: number[] | undefined, byId: Map<string, string>): Genre[] {
  return (ids || []).map((id) => ({ id: String(id), name: byId.get(String(id)) || `Genre ${id}` }));
}
