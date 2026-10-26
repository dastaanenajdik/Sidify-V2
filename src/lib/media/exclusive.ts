/**
 * The exclusive collection — **server side**.
 *
 * This module is the relay transport: it reads the catalogue from this
 * deployment's own serverless functions (via `VaultMediaProvider`) and memoises
 * the results per warm instance. The composition itself lives in
 * `exclusiveCore.ts`, which is transport-agnostic and also runs in the browser.
 *
 *   server (here)      relay  → provider → signed upstream call from Vercel
 *   browser            direct → user's own IP → upstream (see `exclusiveDirect.ts`)
 *
 * Server-only: it imports `vaultProvider`, which uses `node:crypto`. Never
 * import this from a client component — the browser calls
 * `/api/media/exclusive*` or uses `exclusiveDirect.ts`.
 */

import {
  buildExclusiveHome,
  facetsFor,
  genresOfPool,
  getExclusiveHome as composeHome,
  getExclusiveTitle as composeTitle,
  playableFromResources,
  randomTitle,
  searchExclusiveCatalogue as composeSearch,
  suggestExclusive as composeSuggest,
  toPublicSearchPage,
  type CatalogueReader,
  type ExclusiveSearchOptions,
  type ExclusiveSearchResult,
} from "./exclusiveCore";
import { dedupeTitles } from "./recommend";
import type {
  ExclusiveHome,
  ExclusiveTitleResponse,
  ExclusiveSuggestions,
  MediaDetail,
  MediaKind,
  MediaTitle,
} from "./types";
import { getVaultProvider, type VaultMediaProvider } from "./vaultProvider";

/** How long an assembled landing page is reused inside one serverless instance. */
const HOME_TTL_MS = 5 * 60 * 1000;
/** How long a title payload is reused inside one serverless instance. */
const TITLE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Caches are keyed by provider instance, not globally: the process-wide
 * provider is the real one, but tests (and any future per-request provider)
 * must not read each other's payloads.
 */
type CacheStore<T> = WeakMap<VaultMediaProvider, Map<string, CacheEntry<T>>>;

const homeCache: CacheStore<ExclusiveHome> = new WeakMap();
const titleCache: CacheStore<ExclusiveTitleResponse> = new WeakMap();
/** Every map created so far, so `clearExclusiveCache()` can empty them all. */
const createdCaches = new Set<Map<string, CacheEntry<unknown>>>();

function cacheFor<T>(store: CacheStore<T>, provider: VaultMediaProvider): Map<string, CacheEntry<T>> {
  let map = store.get(provider);
  if (!map) {
    map = new Map<string, CacheEntry<T>>();
    store.set(provider, map);
    createdCaches.add(map as unknown as Map<string, CacheEntry<unknown>>);
  }
  return map;
}

/** Test seam: drop every memoised page. */
export function clearExclusiveCache(): void {
  for (const map of createdCaches) map.clear();
}

/* ------------------------------- reader ---------------------------------- */

/**
 * The relay reader: the provider, plus the two things the provider does not
 * return in one call — browser playback sources and the resource listing.
 */
export function relayReader(provider: VaultMediaProvider = getVaultProvider()): CatalogueReader {
  return {
    source: "relay",
    async listing(): Promise<MediaTitle[]> {
      return dedupeTitles(await provider.listing());
    },
    async search(term: string, limit: number): Promise<MediaTitle[]> {
      return provider.searchTitles(term, "all", limit);
    },
    async detail(slug: string, kind: MediaKind): Promise<MediaDetail | null> {
      const detail = kind === "movie" ? await provider.getMovieDetails(slug) : await provider.getSeriesDetails(slug);
      if (!detail) return null;
      const sources = provider.getPlaybackSources ? await provider.getPlaybackSources(kind, slug).catch(() => []) : [];
      return { ...detail, playback: [...(detail.playback ?? []), ...sources] };
    },
  };
}

/* ------------------------------ landing page ----------------------------- */

export async function getExclusiveHome(
  kind: MediaKind | "all" = "all",
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveHome> {
  const cache = cacheFor(homeCache, provider);
  const cached = cache.get(kind);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const home = await composeHome(relayReader(provider), kind);
  cache.set(kind, { value: home, expiresAt: Date.now() + HOME_TTL_MS });
  return home;
}

/* -------------------------------- search --------------------------------- */

export async function searchExclusiveCatalogue(
  options: ExclusiveSearchOptions = {},
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveSearchResult> {
  return composeSearch(relayReader(provider), options);
}

/* ------------------------------- typeahead ------------------------------- */

export async function suggestExclusive(
  query: string,
  limit = 8,
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveSuggestions> {
  return composeSuggest(relayReader(provider), query, limit);
}

/* -------------------------------- detail --------------------------------- */

export async function getExclusiveTitle(
  slug: string,
  kind?: MediaKind,
  provider: VaultMediaProvider = getVaultProvider()
): Promise<ExclusiveTitleResponse | null> {
  const cache = cacheFor(titleCache, provider);
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await composeTitle(relayReader(provider), slug, kind);
  if (value) cache.set(slug, { value, expiresAt: Date.now() + TITLE_TTL_MS });
  return value;
}

/* ------------------------------- re-exports ------------------------------ */
/* The core is transport-agnostic; these re-exports keep the server module the
   single import point it has always been for routes and tests. */

export {
  buildExclusiveHome,
  facetsFor,
  genresOfPool,
  playableFromResources,
  randomTitle,
  toPublicSearchPage,
  type CatalogueReader,
  type ExclusiveSearchOptions,
  type ExclusiveSearchResult,
};
