"use client";

import { create } from "zustand";
import { ART_COUNT } from "@/lib/backdrop";

/**
 * Shared state for the deluxe backdrop slideshow so any screen (hero dots, mini
 * player, settings) can steer it. The actual `<img>` fading lives in
 * `components/DeluxeBackdrop.tsx`.
 *
 * The order is a session-shuffled walk over all 12 artworks: every image shows up
 * once before any repeats, which keeps the rotation fresh instead of random-clumping.
 */
function shuffledOrder(): number[] {
  const idx = Array.from({ length: ART_COUNT }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

interface BackdropState {
  /** Randomised running order (indices into DELUXE_ART). */
  order: number[];
  /** Position inside `order`. */
  pos: number;
  /** Artwork currently fading in. */
  current: number;
  /** Artwork fading out — cleared once the crossfade finishes. */
  previous: number | null;
  /** Bumped on every change so effects/timers can restart. */
  rev: number;

  next: () => void;
  jump: (artIndex: number) => void;
  clearPrevious: () => void;
}

export const useBackdrop = create<BackdropState>()((set, get) => ({
  order: shuffledOrder(),
  pos: 0,
  // -1 keeps the very first paint empty (no random src during SSR hydration);
  // the component advances once it has mounted on the client.
  current: -1,
  previous: null,
  rev: 0,

  next: () => {
    const { order, pos, current } = get();
    const nextPos = (pos + 1) % order.length;
    set({ pos: nextPos, previous: current >= 0 ? current : null, current: order[nextPos], rev: get().rev + 1 });
  },

  jump: (artIndex) => {
    const { order, current } = get();
    const pos = order.indexOf(artIndex);
    if (artIndex === current) return;
    set({
      pos: pos >= 0 ? pos : get().pos,
      previous: current >= 0 ? current : null,
      current: artIndex,
      rev: get().rev + 1,
    });
  },

  clearPrevious: () => set({ previous: null }),
}));

/** Index of the artwork that will show after the current one (for prefetching). */
export function upcomingArt(): number {
  const { order, pos } = useBackdrop.getState();
  return order[(pos + 1) % order.length];
}
