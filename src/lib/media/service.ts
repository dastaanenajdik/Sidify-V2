/**
 * The server-side media service.
 *
 * Chooses the adapter, composes browse payloads (featured + rails + filters) and is
 * the only place playback URLs are assembled. Server-only: it reads `process.env`
 * credentials, so never import it from a client component — use `/api/media/*`.
 */

import { cache } from "react";
import { ArchiveMediaProvider } from "./archiveProvider";
import { DemoMediaProvider } from "./demoProvider";
import { MergedMediaProvider } from "./mergedProvider";
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

export type MediaProviderId = "demo" | "tmdb" | "archive" | "merged";

const providers = new Map<MediaProviderId, MediaProvider>();

/**
 * Provider selection (`MEDIA_PROVIDER`):
 *   auto / merged – TMDb metadata *and* free Internet Archive playback (default).
 *                   Without a TMDb key the archive catalogue becomes the main shelf.
 *   tmdb          – TMDb only; requires credentials, free shelf still available.
 *   archive       – Internet Archive only: real, free, lawfully streamable films.
 *   demo          – the bundled placeholder catalogue.
 *
 * `MEDIA_ARCHIVE=off` disables the free shelf and falls back to TMDb/demo.
 */
export function mediaProviderId(): MediaProviderId {
  const preference = (process.env.MEDIA_PROVIDER || "auto").toLowerCase();
  if (preference === "demo") return "demo";
  if (preference === "tmdb") return "tmdb";
  if (preference === "archive" || preference === "internet-archive" || preference === "ia") return "archive";
  if (preference === "merged") return "merged";
  if ((process.env.MEDIA_ARCHIVE || "").toLowerCase() === "off") return tmdbConfigured() ? "tmdb" : "demo";
  return "merged";
}

export function getMediaProvider(): MediaProvider {
  const id = mediaProviderId();
  const cached = providers.get(id);
  if (cached) return cached;

  const provider: MediaProvider =
    id === "tmdb"
      ? new TmdbMediaProvider()
      : id === "archive"
        ? new ArchiveMediaProvider()
        : id === "demo"
          ? new DemoMediaProvider()
          : new MergedMediaProvider();

  providers.set(id, provider);
  return provider;
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

  const [page, facets, trending, recent, topRated, popular, free] = await Promise.all([
    provider.browse(kind, query),
    provider.getFacets(kind),
    provider[kind === "movie" ? "getTrendingMovies" : "getTrendingSeries"](12),
    provider[kind === "movie" ? "getNewMovieReleases" : "getNewSeriesReleases"](12),
    provider[kind === "movie" ? "getTopRatedMovies" : "getTopRatedSeries"](12),
    provider[kind === "movie" ? "getPopularMovies" : "getPopularSeries"](12),
    // Free-to-watch films (public-domain archive titles) get their own shelf.
    kind === "movie" && provider.getFreeToWatch ? provider.getFreeToWatch(12).catch(() => []) : Promise.resolve([]),
  ]);

  const rails = railsFor(kind, { trending, recent, topRated, popular });
  if (free.length > 0) {
    // Keep the free shelf visible high up, but never above "Trending now".
    rails.splice(Math.min(1, rails.length), 0, {
      id: "free",
      title: "Free to watch",
      subtitle: "Public-domain films that stream in full",
      items: free,
    });
  }

  return {
    ...page,
    kind,
    featured: pickFeatured(trending.length ? trending : page.items),
    rails: filtered ? [] : rails,
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
