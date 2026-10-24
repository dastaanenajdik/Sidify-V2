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
import { mergeSearchResults, railsFor } from "./query";
import { TmdbMediaProvider } from "./tmdbProvider";
import { getVaultProvider, isVaultSlug, type VaultMediaProvider } from "./vaultProvider";
import type {
  MediaBrowse,
  MediaDetail,
  MediaKind,
  MediaPage,
  MediaQuery,
  MediaSearchResponse,
  MediaTitle,
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

/**
 * The secondary ("exclusive") catalogue.
 *
 * It is queried *alongside* the primary provider rather than instead of it, so a search
 * always returns both catalogues' matches. It is never shown as a separate source:
 * its titles are marked with the `vault-` slug prefix, which the UI renders as an
 * "Exclusive" badge.
 */
export function getSecondaryProvider(): VaultMediaProvider {
  return getVaultProvider();
}

/** Whether the exclusive collection is queried at all (on unless explicitly disabled). */
export function exclusiveCollectionEnabled(): boolean {
  const flag = (process.env.MEDIA_EXCLUSIVE_COLLECTION || "1").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off" && flag !== "no";
}

/** Titles from the secondary catalogue, best-effort — never throws into a search. */
async function secondarySearch(query: string, kind: MediaKind | "all", limit: number): Promise<MediaTitle[]> {
  if (!exclusiveCollectionEnabled()) return [];
  try {
    return await getSecondaryProvider().searchTitles(query, kind, limit);
  } catch {
    return [];
  }
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
  const isContinuation = (query.page ?? 1) > 1;

  if (filtered || isContinuation) {
    const [page, facets] = await Promise.all([provider.browse(kind, query), provider.getFacets(kind)]);
    return {
      ...page,
      kind,
      featured: null,
      rails: [],
      facets,
      provider: provider.info,
      filtered,
    };
  }

  const [page, facets, trending, recent, topRated, popular, free, exclusive] = await Promise.all([
    provider.browse(kind, query),
    provider.getFacets(kind),
    provider[kind === "movie" ? "getTrendingMovies" : "getTrendingSeries"](12).catch(() => []),
    provider[kind === "movie" ? "getNewMovieReleases" : "getNewSeriesReleases"](12).catch(() => []),
    provider[kind === "movie" ? "getTopRatedMovies" : "getTopRatedSeries"](12).catch(() => []),
    provider[kind === "movie" ? "getPopularMovies" : "getPopularSeries"](12).catch(() => []),
    kind === "movie" && provider.getFreeToWatch ? provider.getFreeToWatch(12).catch(() => []) : Promise.resolve([]),
    // The exclusive collection gets its own shelf on the browse page.
    secondarySearch("2024", kind, 12),
  ]);

  const rails = railsFor(kind, { trending, recent, topRated, popular });

  if (exclusive.length > 0) {
    rails.push({
      id: "exclusive",
      title: "Exclusive picks",
      subtitle: "Titles only available in the exclusive collection",
      items: exclusive,
    });
  }

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
  const term = query.trim();
  if (!term) return { query, items: [], provider: provider.info };

  // Both catalogues answer every search: the primary provider's matches come first,
  // then the exclusive catalogue's, minus titles the primary already returned.
  const [primaryItems, secondaryItems] = await Promise.all([
    provider.searchTitles(term, kind, limit).catch(() => []),
    secondarySearch(term, kind, limit),
  ]);

  const merged = mergeSearchResults(primaryItems, secondaryItems);
  const exclusiveCount = merged.length - primaryItems.length;

  return { query, items: merged.slice(0, Math.max(limit, exclusiveCount)), provider: provider.info };
}

/**
 * The exclusive collection on its own.
 *
 * Only the exclusive catalogue answers here — the main catalogue never contributes.
 * With no query, the collection's own discovery listings are returned instead.
 */
export async function searchExclusive(
  query: string,
  kind: MediaKind | "all" = "all",
  limit = 24
): Promise<MediaSearchResponse> {
  const provider = getSecondaryProvider();
  const term = query.trim();

  if (!exclusiveCollectionEnabled()) {
    return { query: term, items: [], provider: provider.info };
  }

  if (!term) {
    const items = await provider.discovery(kind, limit);
    return { query: "", items, provider: provider.info };
  }

  const items = await provider.searchTitles(term, kind, limit);
  return { query: term, items, provider: provider.info };
}

/* --------------------------------- detail -------------------------------- */

async function loadDetail(kind: MediaKind, slug: string): Promise<MediaDetail | null> {
  // Titles from the exclusive catalogue carry the `vault-` prefix and are served by
  // the secondary provider; everything else comes from the primary one.
  const provider = isVaultSlug(slug) && exclusiveCollectionEnabled() ? getSecondaryProvider() : getMediaProvider();
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
  const provider = isVaultSlug(slug) && exclusiveCollectionEnabled() ? getSecondaryProvider() : getMediaProvider();
  return provider.getSeriesSeasons(slug, seasonNumber);
}
