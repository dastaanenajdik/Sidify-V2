"use client";

import { useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ExclusiveHome, ExclusiveSearchPage, ExclusiveTitleResponse } from "./types";
import { useQueryClient } from "@tanstack/react-query";
import { mediaApi } from "./client";
import {
  loadExclusiveHome,
  loadExclusiveSearch,
  loadExclusiveSuggestions,
  loadExclusiveTitle,
} from "./exclusiveDirect";
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
 * How long a payload stays fresh in the browser.
 *
 * Five minutes: long enough that moving between the section, a title page and
 * back costs nothing, short enough that a new release shows up in the same
 * visit. The snapshot in localStorage is the *next* layer down (7 days), and it
 * is always labelled with its age — a stale shelf is honest, a blank one is not.
 */
export const EXCLUSIVE_STALE_MS = 5 * 60_000;
/** Keep the payload in the cache for an hour after it goes stale (instant back-nav). */
export const EXCLUSIVE_GC_MS = 60 * 60_000;

/**
 * The exclusive collection's landing payload: spotlight, rails, genres, facets.
 *
 * Fetched from the browser (the user's own IP), falling back to the relay route
 * and finally to the last saved snapshot. An empty query is the landing page,
 * not an empty result set — the section is never blank just because nothing has
 * been typed.
 */
export function useExclusiveHome(kind: MediaKind | "all" = "all") {
  return useQuery<ExclusiveHome>({
    queryKey: ["media-exclusive-home", kind],
    queryFn: () => loadExclusiveHome(kind, () => mediaApi.exclusiveHome(kind)),
    staleTime: EXCLUSIVE_STALE_MS,
    gcTime: EXCLUSIVE_GC_MS,
    // The loader already retries direct → relay → snapshot; a fourth attempt
    // from React Query would just hammer the upstream.
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * The exclusive collection's own results.
 *
 * Unlike `useMediaSearch`, this never mixes in the main catalogue — the section
 * shows exactly one source. Filters, sort and page are part of the key, so each
 * view is cached on its own (and `placeholderData` keeps the previous page on
 * screen while the next one loads, instead of flashing a skeleton).
 */
export function useExclusiveSearch(filters: ExclusiveQuery, enabled = true) {
  return useQuery<ExclusiveSearchPage>({
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
    queryFn: () => loadExclusiveSearch(filters, () => mediaApi.exclusiveSearch(filters)),
    enabled,
    staleTime: EXCLUSIVE_STALE_MS,
    gcTime: EXCLUSIVE_GC_MS,
    retry: 0,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });
}

/** One exclusive title: metadata, playback sources and recommendations. */
export function useExclusiveTitle(slug: string | null, kind?: MediaKind) {
  return useQuery<ExclusiveTitleResponse>({
    queryKey: ["media-exclusive-title", slug, kind ?? "auto"],
    queryFn: () => loadExclusiveTitle(slug as string, kind, () => mediaApi.exclusiveTitle(slug as string, kind)),
    enabled: Boolean(slug),
    staleTime: 10 * EXCLUSIVE_STALE_MS,
    gcTime: EXCLUSIVE_GC_MS,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

/** Typeahead for the exclusive search field — only fires from two characters. */
export function useExclusiveSuggestions(term: string, enabled = true) {
  const trimmed = term.trim();
  return useQuery({
    queryKey: ["media-exclusive-suggest", trimmed],
    queryFn: () => loadExclusiveSuggestions(trimmed, 8),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * Warms the landing payload in the background, so opening `/exclusive` is
 * instant rather than a spinner.
 *
 * `enabled` is the caller's decision about *whether this visitor wants films*:
 * the shell only turns it on for the visual-media routes, so a music-only
 * session never touches the second catalogue. React Query de-duplicates the
 * request, and a fresh cache is left alone, so this is never a second fetch.
 */
export function usePrefetchExclusive(enabled = true): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    void client.prefetchQuery({
      queryKey: ["media-exclusive-home", "all"],
      queryFn: () => loadExclusiveHome("all", () => mediaApi.exclusiveHome("all")),
      staleTime: EXCLUSIVE_STALE_MS,
    });
  }, [client, enabled]);
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
