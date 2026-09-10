"use client";

import { create } from "zustand";
import type { Track } from "@/lib/types";

export interface Toast {
  id: number;
  title: string;
  desc?: string;
  kind?: "ok" | "info" | "warn";
}

interface MenuState {
  track: Track;
  x: number;
  y: number;
}

interface UiState {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;

  menu: MenuState | null;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;

  addToPlaylistTrack: Track | null;
  setAddToPlaylistTrack: (t: Track | null) => void;

  sleepMenuOpen: boolean;
  setSleepMenuOpen: (v: boolean) => void;

  downloadProgress: Record<string, number>;
  setDownloadProgress: (id: string, pct: number | null) => void;
}

let toastId = 1;

export const useUi = create<UiState>()((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), 3800);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  menu: null,
  openMenu: (m) => set({ menu: m }),
  closeMenu: () => set({ menu: null }),

  addToPlaylistTrack: null,
  setAddToPlaylistTrack: (t) => set({ addToPlaylistTrack: t }),

  sleepMenuOpen: false,
  setSleepMenuOpen: (v) => set({ sleepMenuOpen: v }),

  downloadProgress: {},
  setDownloadProgress: (id, pct) => {
    const next = { ...get().downloadProgress };
    if (pct === null) delete next[id];
    else next[id] = pct;
    set({ downloadProgress: next });
  },
}));
