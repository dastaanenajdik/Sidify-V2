"use client";

import { create } from "zustand";
import type { Track } from "@/lib/types";

export interface Toast {
  id: number;
  title: string;
  desc?: string;
  kind?: "ok" | "info" | "warn";
  /** Autodismiss delay in ms. Defaults to 3800. */
  duration?: number;
  /** Countdown bar progress (0-100) for toasts that own a live timer. */
  pct?: number;
}

interface MenuState {
  track: Track;
  x: number;
  y: number;
}

interface UiState {
  toasts: Toast[];
  /** Returns the new toast id, so callers can update (countdown) or dismiss it. */
  pushToast: (t: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;

  menu: MenuState | null;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;

  addToPlaylistTrack: Track | null;
  setAddToPlaylistTrack: (t: Track | null) => void;

  sleepMenuOpen: boolean;
  setSleepMenuOpen: (v: boolean) => void;

  bgHelpOpen: boolean;
  setBgHelpOpen: (v: boolean) => void;

  /** Mood inferred from the current track — tints the deluxe backdrop. */
  mood: string | null;
  /** The mood before the last change, kept so the tint can crossfade. */
  prevMood: string | null;
  setMood: (m: string | null) => void;

  downloadProgress: Record<string, number>;
  setDownloadProgress: (id: string, pct: number | null) => void;
}

let toastId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.duration ?? 3800);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  menu: null,
  openMenu: (m) => set({ menu: m }),
  closeMenu: () => set({ menu: null }),

  addToPlaylistTrack: null,
  setAddToPlaylistTrack: (t) => set({ addToPlaylistTrack: t }),

  sleepMenuOpen: false,
  setSleepMenuOpen: (v) => set({ sleepMenuOpen: v }),

  bgHelpOpen: false,
  setBgHelpOpen: (v) => set({ bgHelpOpen: v }),

  mood: null,
  prevMood: null,
  setMood: (m) => set((st) => (st.mood === m ? {} : { prevMood: st.mood, mood: m })),

  downloadProgress: {},
  setDownloadProgress: (id, pct) => {
    const next = { ...get().downloadProgress };
    if (pct === null) delete next[id];
    else next[id] = pct;
    set({ downloadProgress: next });
  },
}));
