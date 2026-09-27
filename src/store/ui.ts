"use client";

import { create } from "zustand";
import type { Track } from "@/lib/types";

export interface Toast {
  id: number;
  title: string;
  desc?: string;
  kind?: "ok" | "info" | "warn";
  /** Autodismiss delay in ms. Defaults to 3800. `0` keeps it until it is replaced
   *  or dismissed — used by the download toast, which lives as long as the download. */
  duration?: number;
  /** Progress ring (0-100) drawn on the right edge of the toast. */
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
  /** Patches a toast in place — how the download toast shows a live percentage. */
  updateToast: (id: number, patch: Partial<Omit<Toast, "id">>) => void;
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

  downloadProgress: Record<string, number>;
  setDownloadProgress: (id: string, pct: number | null) => void;
}

let toastId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    // duration 0 = sticky: the owner replaces or dismisses it (downloads, retries).
    if (t.duration !== 0) setTimeout(() => get().dismissToast(id), t.duration ?? 3800);
    return id;
  },
  updateToast: (id, patch) => set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
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

  downloadProgress: {},
  setDownloadProgress: (id, pct) => {
    const next = { ...get().downloadProgress };
    if (pct === null) delete next[id];
    else next[id] = pct;
    set({ downloadProgress: next });
  },
}));
