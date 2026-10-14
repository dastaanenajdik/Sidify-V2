"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light" | "system";
export type Quality = "low" | "medium" | "high";
export type LyricsSize = "s" | "m" | "l";

export const EQ_PRESETS: Record<string, { label: string; gains: number[] }> = {
  flat: { label: "Flat", gains: [0, 0, 0, 0, 0] },
  bass: { label: "Bass Boost", gains: [7, 5, 2, 0, -1] },
  rock: { label: "Rock", gains: [4, 2, -2, 1, 4] },
  treble: { label: "Treble", gains: [-3, -1, 0, 3, 6] },
  vocal: { label: "Vocal", gains: [-3, -1, 2, 5, 4] },
  custom: { label: "Custom", gains: [0, 0, 0, 0, 0] },
};

export const EQ_BANDS = [60, 230, 910, 3600, 14000];

export const REGIONS = [
  { id: "US", name: "United States" },
  { id: "GB", name: "United Kingdom" },
  { id: "IN", name: "India" },
  { id: "DE", name: "Germany" },
  { id: "FR", name: "France" },
  { id: "JP", name: "Japan" },
  { id: "BR", name: "Brazil" },
  { id: "AU", name: "Australia" },
];

interface SettingsState {
  theme: ThemeMode;
  language: string;
  region: string;

  wifiQuality: Quality;
  mobileQuality: Quality;
  crossfadeSecs: number;
  gapless: boolean;
  /** Keep similar music playing after the queue runs out (the ∞ in the queue). */
  autoplay: boolean;
  /** Autoplay follows YouTube Music's own "Up next" queue instead of keyword guesses. */
  ytRadio: boolean;
  rememberPosition: boolean;

  eqPreset: string;
  eqGains: number[];
  normalization: boolean;
  balance: number; // -1 .. 1

  downloadQuality: Quality;
  wifiOnlyDownloads: boolean;
  autoDownloadLiked: boolean;

  mediaControls: boolean;
  notifControls: boolean;
  bluetoothAutoplay: boolean;

  explicitFilter: boolean;

  /** Tint the player and pages with colours sampled from the artwork. */
  dynamicColor: boolean;
  /** Calmer motion: no artwork breathing, no lyric blur, no drifting backdrop. */
  reduceMotion: boolean;

  /** Open lyrics in the timed (karaoke) view whenever timestamps exist. */
  lyricsSynced: boolean;
  lyricsSize: LyricsSize;

  /** Playlist ids pinned to the front of the Library. */
  pinnedPlaylists: number[];
  libraryLayout: "grid" | "list";

  profileName: string;
  profileEmail: string;
  /** True once the first-visit "what's your name?" gate has been answered (or skipped with a name already saved). */
  nameAsked: boolean;

  set: (p: Partial<SettingsState>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      language: "en",
      region: "US",

      wifiQuality: "high",
      mobileQuality: "medium",
      crossfadeSecs: 0,
      gapless: true,
      autoplay: true,
      ytRadio: true,
      rememberPosition: true,

      eqPreset: "flat",
      eqGains: [0, 0, 0, 0, 0],
      normalization: true,
      balance: 0,

      downloadQuality: "high",
      wifiOnlyDownloads: false,
      autoDownloadLiked: false,

      mediaControls: true,
      notifControls: true,
      bluetoothAutoplay: false,

      explicitFilter: false,

      dynamicColor: true,
      reduceMotion: false,

      lyricsSynced: true,
      lyricsSize: "m",

      pinnedPlaylists: [],
      libraryLayout: "grid",

      profileName: "",
      profileEmail: "",
      nameAsked: false,

      set: (p) => set(p),
    }),
    // Rehydrated by <StoreHydration/> after mount, so the first client render
    // matches the server's (defaults) and hydration never mismatches.
    { name: "sidify-settings", skipHydration: true }
  )
);

/** Effective EQ gains (preset-derived unless custom) */
export function effectiveGains(s: Pick<SettingsState, "eqPreset" | "eqGains">): number[] {
  if (s.eqPreset === "custom") return s.eqGains;
  return EQ_PRESETS[s.eqPreset]?.gains ?? [0, 0, 0, 0, 0];
}
