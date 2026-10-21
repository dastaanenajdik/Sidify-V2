/**
 * The server-side media service.
 *
 * Chooses the adapter, composes browse payloads (featured + rails + filters) and is
 * the only place playback URLs are assembled. Server-only: it reads `process.env`
 * credentials, so never import it from a client component — use `/api/media/*`.
 */

import { cache } from "react";
import { DemoMediaProvider } from "./demoProvider";
import type { MediaProvider } from "./provider";
import { dedupeSources, manifestSources } from "./playback";
import { railsFor } from "./query";
import { TmdbMediaProvider, tmdbConfigured } from "./tmdbProvider";
import type {
  MediaBrowse,
  MediaDetail,
  MediaKind,
  MediaPage,
  MediaQuery,
  MediaSearchResponse,
  ProviderInfo,
  Season,
} from "./types";

/* ------------------------------- choosing -------------------------------- */

let demoProvider: DemoMediaProvider | null = null;
let tmdbProvider: TmdbMediaProvider | null = null;

/**
 * `MEDIA_PROVIDER=demo` forces the bundled catalogue, `=tmdb` requires credentials,
 * and the default (`auto`) uses TMDb when a key/token is present.
 */
export function mediaProviderId(): "demo" | "tmdb" {
  const preference = (process.env.MEDIA_PROVIDER || "auto").toLowerCase();
  if (preference === "demo") return "demo";
  if (preference === "tmdb") return "tmdb";
  return tmdbConfigured() ? "tmdb" : "demo";
}

export function getMediaProvider(): MediaProvider {
  if (mediaProviderId() === "tmdb") {
    tmdbProvider ??= new TmdbMediaProvider();
    return tmdbProvider;
  }
  demoProvider ??= new DemoMediaProvider();
  return demoProvider;
}

export function mediaProviderInfo(): ProviderInfo {
  return getMediaProvider().info;
}

/* ------------------------------- playback -------------------------------- */

/** Playback assembly is provider + optional operator manifest only — see `playback.ts`. */
export { parsePlaybackManifest, playbackManifest, sanitizePlaybackSource } from "./playback";

/* -------------------------------- browsing ------------------------------- */

function isFiltered(query: MediaQuery): boolean {
  return Boolean(query.q?.trim() || query.genre || query.year || query.language) || (!!query.sort && query.sort !== "trending");
}

/** Featured title: the top trending entry, preferring one with a wide backdrop. */
function pickFeatured(items: import("./types").MediaTitle[]) {
  return items.find((item) => item.backdrop) ?? items[0] ?? null;
}

export async function browseMedia(kind: MediaKind, query: MediaQuery): Promise<MediaBrowse> {
  const provider = getMediaProvider();
  const filtered = isFiltered(query);

  const [page, facets, trending, recent, topRated, popular] = await Promise.all([
    provider.browse(kind, query),
    provider.getFacets(kind),
    provider[kind === "movie" ? "getTrendingMovies" : "getTrendingSeries"](12),
    provider[kind === "movie" ? "getNewMovieReleases" : "getNewSeriesReleases"](12),
    provider[kind === "movie" ? "getTopRatedMovies" : "getTopRatedSeries"](12),
    provider[kind === "movie" ? "getPopularMovies" : "getPopularSeries"](12),
  ]);

  return {
    ...page,
    kind,
    featured: pickFeatured(trending.length ? trending : page.items),
    rails: filtered ? [] : railsFor(kind, { trending, recent, topRated, popular }),
    facets,
    provider: provider.info,
    filtered,
  };
}

export async function browsePage(kind: MediaKind, query: MediaQuery): Promise<MediaPage> {
  return getMediaProvider().browse(kind, query);
}

export async function searchMedia(query: string, kind: MediaKind | "all" = "all", limit = 24): Promise<MediaSearchResponse> {
  const provider = getMediaProvider();
  const items = query.trim() ? await provider.searchTitles(query.trim(), kind, limit) : [];
  return { query, items, provider: provider.info };
}

/* --------------------------------- detail -------------------------------- */

async function loadDetail(kind: MediaKind, slug: string): Promise<MediaDetail | null> {
  const provider = getMediaProvider();
  const detail = kind === "movie" ? await provider.getMovieDetails(slug) : await provider.getSeriesDetails(slug);
  if (!detail) return null;

  const providerSources = provider.getPlaybackSources ? await provider.getPlaybackSources(kind, slug) : [];
  return {
    ...detail,
    playback: dedupeSources([...manifestSources(kind, slug), ...(detail.playback || []), ...providerSources]),
    attribution: detail.attribution ?? provider.info.attribution,
  };
}

/** Deduped per request, so `generateMetadata` and the page share one provider call. */
export const getMediaDetail = cache(loadDetail);

export async function getSeasons(kind: MediaKind, slug: string, seasonNumber?: number): Promise<Season[]> {
  return getMediaProvider().getSeriesSeasons(slug, seasonNumber);
}
