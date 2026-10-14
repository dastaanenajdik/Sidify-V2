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
  /** Index of the row inside the live queue, when the menu was opened from it. */
  queueIndex?: number;
}

/** The desktop column beside the page (Apple Music's right-hand sidebar). */
export type SidePanel = "lyrics" | "queue" | null;

export interface LyricsShare {
  track: Track;
  lines: string[];
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

  createPlaylistOpen: boolean;
  /** Track to drop into the playlist right after it is created (from "Add to playlist"). */
  createPlaylistSeed: Track | null;
  setCreatePlaylistOpen: (v: boolean, seed?: Track | null) => void;

  sleepMenuOpen: boolean;
  setSleepMenuOpen: (v: boolean) => void;

  statsOpen: boolean;
  setStatsOpen: (v: boolean) => void;

  lyricsShare: LyricsShare | null;
  setLyricsShare: (v: LyricsShare | null) => void;

  sidePanel: SidePanel;
  setSidePanel: (p: SidePanel) => void;
  toggleSidePanel: (p: Exclude<SidePanel, null>) => void;

  downloadProgress: Record<string, number>;
  setDownloadProgress: (id: string, pct: number | null) => void;
}

let toastId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.duration ?? 3800);
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  menu: null,
  openMenu: (m) => set({ menu: m }),
  closeMenu: () => set({ menu: null }),

  addToPlaylistTrack: null,
  setAddToPlaylistTrack: (t) => set({ addToPlaylistTrack: t }),

  createPlaylistOpen: false,
  createPlaylistSeed: null,
  setCreatePlaylistOpen: (v, seed = null) => set({ createPlaylistOpen: v, createPlaylistSeed: v ? seed : null }),

  sleepMenuOpen: false,
  setSleepMenuOpen: (v) => set({ sleepMenuOpen: v }),

  statsOpen: false,
  setStatsOpen: (v) => set({ statsOpen: v }),

  lyricsShare: null,
  setLyricsShare: (v) => set({ lyricsShare: v }),

  sidePanel: null,
  setSidePanel: (p) => set({ sidePanel: p }),
  toggleSidePanel: (p) => set({ sidePanel: get().sidePanel === p ? null : p }),

  downloadProgress: {},
  setDownloadProgress: (id, pct) => {
    const next = { ...get().downloadProgress };
    if (pct === null) delete next[id];
    else next[id] = pct;
    set({ downloadProgress: next });
  },
}));
