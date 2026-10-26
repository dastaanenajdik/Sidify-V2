"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { mediaApi } from "./client";
import type { ExclusiveQuery, MediaBrowse, MediaKind, MediaQuery } from "./types";

/** Paged browse query — filters are the key, so changing one starts a fresh page 1. */
export function useMediaBrowse(kind: MediaKind, query: MediaQuery) {
  return useInfiniteQuery({
    queryKey: ["media-browse", kind, query.q ?? "", query.genre ?? "", query.year ?? "", query.language ?? "", query.sort ?? "trending"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => mediaApi.browse(kind, query, pageParam),
    getNextPageParam: (last: MediaBrowse) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** "Movies & series" matches for the music search page. */
export function useMediaSearch(term: string, enabled = true, limit = 12) {
  return useQuery({
    queryKey: ["media-search", term, limit],
    queryFn: () => mediaApi.search(term, "all", limit),
    enabled: enabled && term.trim().length > 1,
    staleTime: 2 * 60_000,
    retry: 0,
  });
}

/**
 * The exclusive collection's landing payload: spotlight, rails, genres, facets.
 *
 * An empty query is the landing page, not an empty result set — the section is
 * never blank just because nothing has been typed.
 */
export function useExclusiveHome(kind: MediaKind | "all" = "all") {
  return useQuery({
    queryKey: ["media-exclusive-home", kind],
    queryFn: () => mediaApi.exclusiveHome(kind),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/**
 * The exclusive collection's own results.
 *
 * Unlike `useMediaSearch`, this never mixes in the main catalogue — the section shows
 * exactly one source. Filters, sort and page are part of the key, so each view is
 * cached on its own.
 */
export function useExclusiveSearch(filters: ExclusiveQuery, enabled = true) {
  return useQuery({
    queryKey: [
      "media-exclusive",
      filters.q ?? "",
      filters.kind ?? "all",
      filters.genre ?? "",
      filters.year ?? "",
      filters.language ?? "",
      filters.sort ?? "trending",
      filters.page ?? 1,
      filters.limit ?? 24,
    ],
    queryFn: () => mediaApi.exclusiveSearch(filters),
    enabled,
    staleTime: 2 * 60_000,
    retry: 0,
    placeholderData: (previous) => previous,
  });
}

/** One exclusive title: metadata, playback sources and recommendations. */
export function useExclusiveTitle(slug: string | null, kind?: MediaKind) {
  return useQuery({
    queryKey: ["media-exclusive-title", slug, kind ?? "auto"],
    queryFn: () => mediaApi.exclusiveTitle(slug as string, kind),
    enabled: Boolean(slug),
    staleTime: 10 * 60_000,
    retry: 0,
  });
}

/** Typeahead for the exclusive search field — only fires from two characters. */
export function useExclusiveSuggestions(term: string, enabled = true) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: ["media-exclusive-suggest", trimmed],
    queryFn: () => mediaApi.exclusiveSuggest(trimmed, 8),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * Episodes for one season, fetched the first time the season is opened. Providers that
 * already returned episodes with the detail response never trigger this.
 */
export function useSeasonEpisodes(slug: string, seasonNumber: number, enabled: boolean) {
  return useQuery({
    queryKey: ["media-season", slug, seasonNumber],
    queryFn: () => mediaApi.season(slug, seasonNumber),
    enabled,
    staleTime: 30 * 60_000,
    retry: 1,
  });
}
