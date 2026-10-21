"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { mediaApi } from "./client";
import type { MediaBrowse, MediaKind, MediaQuery } from "./types";

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
