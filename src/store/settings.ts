"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light" | "system";
export type Quality = "low" | "medium" | "high";

export const ACCENTS = [
  { id: "neon", name: "Neon Green", value: "#00E676" },
  { id: "violet", name: "Electric Violet", value: "#8B5CF6" },
  { id: "cyan", name: "Cyan Pulse", value: "#22D3EE" },
  { id: "pink", name: "Hot Pink", value: "#F472B6" },
  { id: "orange", name: "Sunset Orange", value: "#FB923C" },
  { id: "blue", name: "Royal Blue", value: "#3B82F6" },
];

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
  accent: string;
  language: string;
  region: string;

  wifiQuality: Quality;
  mobileQuality: Quality;
  crossfadeSecs: number;
  gapless: boolean;
  autoplay: boolean;
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

  profileName: string;
  profileEmail: string;

  set: (p: Partial<SettingsState>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      accent: "#00E676",
      language: "en",
      region: "US",

      wifiQuality: "high",
      mobileQuality: "medium",
      crossfadeSecs: 0,
      gapless: true,
      autoplay: true,
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

      profileName: "Siddharth",
      profileEmail: "",

      set: (p) => set(p),
    }),
    { name: "sidify-settings" }
  )
);

/** Effective EQ gains (preset-derived unless custom) */
export function effectiveGains(s: Pick<SettingsState, "eqPreset" | "eqGains">): number[] {
  if (s.eqPreset === "custom") return s.eqGains;
  return EQ_PRESETS[s.eqPreset]?.gains ?? [0, 0, 0, 0, 0];
}
