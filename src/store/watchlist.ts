"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaKind, MediaTitle } from "@/lib/media/types";

/**
 * Movies & series watchlist — local-first, like the rest of Sidify.
 *
 * The music library is mirrored to Postgres, but there is no account system for video
 * yet, so this store persists to `localStorage` (rehydrated by `<StoreHydration/>` with
 * `skipHydration`, so the first client render still matches the server's). Swapping in
 * a server-backed store later only means changing this file.
 */

export interface WatchlistEntry {
  /** `${kind}:${slug}` — stable across providers. */
  id: string;
  kind: MediaKind;
  slug: string;
  title: string;
  year?: number;
  poster?: string | null;
  accent?: string;
  rating?: number;
  addedAt: number;
}

interface WatchlistState {
  items: WatchlistEntry[];
  isSaved: (kind: MediaKind, slug: string) => boolean;
  /** Adds or removes the title and returns its new saved state. */
  toggle: (title: MediaTitle) => boolean;
  remove: (kind: MediaKind, slug: string) => void;
  clear: () => void;
}

const keyOf = (kind: MediaKind, slug: string) => `${kind}:${slug}`;

const entryOf = (title: MediaTitle): WatchlistEntry => ({
  id: keyOf(title.kind, title.slug),
  kind: title.kind,
  slug: title.slug,
  title: title.title,
  year: title.year,
  poster: title.poster ?? null,
  accent: title.accent,
  rating: title.rating,
  addedAt: Date.now(),
});

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      items: [],
      isSaved: (kind, slug) => get().items.some((item) => item.id === keyOf(kind, slug)),
      toggle: (title) => {
        const id = keyOf(title.kind, title.slug);
        const saved = get().items.some((item) => item.id === id);
        set({
          items: saved ? get().items.filter((item) => item.id !== id) : [entryOf(title), ...get().items].slice(0, 500),
        });
        return !saved;
      },
      remove: (kind, slug) => set({ items: get().items.filter((item) => item.id !== keyOf(kind, slug)) }),
      clear: () => set({ items: [] }),
    }),
    {
      name: "sidify-watchlist",
      skipHydration: true,
      partialize: (state) => ({ items: state.items }),
    }
  )
);
