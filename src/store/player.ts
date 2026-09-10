"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "@/lib/types";

export type RepeatMode = "off" | "all" | "one";

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

  fullPlayerOpen: boolean;
  queueOpen: boolean;
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

      fullPlayerOpen: false,
      queueOpen: false,
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
