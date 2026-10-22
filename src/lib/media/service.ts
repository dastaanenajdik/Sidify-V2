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
import { FourKHDHubMediaProvider } from "./hubProvider";
import { MergedMediaProvider } from "./mergedProvider";
import type { MediaProvider } from "./provider";
import { dedupeSources, manifestSources } from "./playback";
import { railsFor } from "./query";
import { TmdbMediaProvider } from "./tmdbProvider";
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

export type MediaProviderId = "4khdhub" | "demo" | "tmdb" | "archive" | "merged";

const providers = new Map<MediaProviderId, MediaProvider>();

/**
 * Provider selection (`MEDIA_PROVIDER`):
 *   auto / 4khdhub / hub – Server-side 4KHDHub catalogue & mirror adapter (default).
 *                          Does NOT silently replace results with Demo or Archive data
 *                          if the upstream host is unreachable.
 *   merged               – Explicit opt-in: TMDb metadata + Internet Archive items.
 *   tmdb                 – Explicit opt-in: TMDb metadata only (requires credentials).
 *   archive              – Explicit opt-in: Internet Archive items only.
 *   demo                 – Explicit opt-in: bundled placeholder catalogue.
 */
export function mediaProviderId(): MediaProviderId {
  const preference = (process.env.MEDIA_PROVIDER || "auto").toLowerCase().trim();
  if (preference === "demo") return "demo";
  if (preference === "tmdb") return "tmdb";
  if (preference === "archive" || preference === "internet-archive" || preference === "ia") return "archive";
  if (preference === "merged") return "merged";
  return "4khdhub";
}

export function clearMediaProviderCache(): void {
  providers.clear();
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
          : id === "merged"
            ? new MergedMediaProvider()
            : new FourKHDHubMediaProvider();

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

/** Featured title: the top trending entry, preferring one with backdrop/poster art. */
function pickFeatured(items: import("./types").MediaTitle[]) {
  return items.find((item) => item.backdrop) ?? items[0] ?? null;
}

export async function browseMedia(kind: MediaKind, query: MediaQuery): Promise<MediaBrowse> {
  const provider = getMediaProvider();
  const filtered = isFiltered(query);

  if (filtered) {
    const [page, facets] = await Promise.all([provider.browse(kind, query), provider.getFacets(kind)]);
    return {
      ...page,
      kind,
      featured: null,
      rails: [],
      facets,
      provider: provider.info,
      filtered: true,
    };
  }

  const [page, facets, trending, recent, topRated, popular, free] = await Promise.all([
    provider.browse(kind, query),
    provider.getFacets(kind),
    provider[kind === "movie" ? "getTrendingMovies" : "getTrendingSeries"](12),
    provider[kind === "movie" ? "getNewMovieReleases" : "getNewSeriesReleases"](12),
    provider[kind === "movie" ? "getTopRatedMovies" : "getTopRatedSeries"](12),
    provider[kind === "movie" ? "getPopularMovies" : "getPopularSeries"](12),
    kind === "movie" && provider.getFreeToWatch ? provider.getFreeToWatch(12).catch(() => []) : Promise.resolve([]),
  ]);

  const rails = railsFor(kind, { trending, recent, topRated, popular });
  if (free.length > 0) {
    rails.splice(Math.min(1, rails.length), 0, {
      id: "free",
      title: "Archive collection",
      subtitle: "Community & archival uploads — rights vary by item",
      items: free,
    });
  }

  return {
    ...page,
    kind,
    featured: pickFeatured(trending.length ? trending : page.items),
    rails,
    facets,
    provider: provider.info,
    filtered: false,
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
