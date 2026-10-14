"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "@/lib/types";

export type RepeatMode = "off" | "all" | "one";

/**
 * Where an upcoming queue row came from, which is what splits the queue into
 * its sections: "Next in queue" (the listener added it), "Next from …" (the
 * album / playlist / search it was started from — the default, no entry) and
 * "AutoPlay" (similar music the app lined up by itself).
 */
export type QueueTier = "user" | "autoplay";

/** What the Now Playing screen shows in its main area. */
export type NowPlayingView = "art" | "lyrics" | "queue";

interface PlayerState {
  queue: Track[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  resumeFromMs: number;

  volume: number; // 0..1
  speed: number; // 0.5..2
  shuffle: boolean;
  repeat: RepeatMode;

  /** Queue tier per track id (absent = came with the context). */
  tiers: Record<string, QueueTier>;
  /** AutoPlay is fetching similar songs in the background. */
  autoplayLoading: boolean;

  fullPlayerOpen: boolean;
  npView: NowPlayingView;
  eqOpen: boolean;
  videoMode: boolean;
  engineMode: "native" | "iframe" | null;

  sleepMode: null | "timer" | "eot";
  sleepEndsAt: number | null;

  contextLabel: string;

  likedIds: Record<string, boolean>;
  downloadedIds: Record<string, boolean>;

  set: (p: Partial<PlayerState>) => void;
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      index: -1,
      isPlaying: false,
      isLoading: false,
      positionMs: 0,
      durationMs: 0,
      resumeFromMs: 0,

      volume: 0.85,
      speed: 1,
      shuffle: false,
      repeat: "off",

      tiers: {},
      autoplayLoading: false,

      fullPlayerOpen: false,
      npView: "art",
      eqOpen: false,
      videoMode: false,
      engineMode: null,

      sleepMode: null,
      sleepEndsAt: null,

      contextLabel: "",

      likedIds: {},
      downloadedIds: {},

      set: (p) => set(p),
    }),
    {
      name: "sidify-player",
      skipHydration: true,
      partialize: (s) => ({
        volume: s.volume,
        speed: s.speed,
        shuffle: s.shuffle,
        repeat: s.repeat,
        videoMode: s.videoMode,
      }),
    }
  )
);

export function currentTrack(s: Pick<PlayerState, "queue" | "index">): Track | null {
  if (s.index < 0 || s.index >= s.queue.length) return null;
  return s.queue[s.index];
}

/** The track that plays after the current one (ignores shuffle's random pick). */
export function upNextTrack(s: Pick<PlayerState, "queue" | "index" | "repeat">): Track | null {
  if (s.index < 0) return null;
  if (s.index + 1 < s.queue.length) return s.queue[s.index + 1];
  if (s.repeat === "all" && s.queue.length > 1) return s.queue[0];
  return null;
}
