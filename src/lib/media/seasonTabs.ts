/**
 * Series layout: one tab per season, and every season's downloads live inside its own tab.
 *
 * Episodes come from the provider's `seasons`; season-level downloads (complete-season
 * ZIP packs etc.) come from `releases` and are matched by `seasonNumber`. A season that
 * only has a pack still gets a tab. Downloads that name no season go to a final
 * "More downloads" tab instead of being mixed into a season.
 */

import { sortByQuality } from "./playbackPlan";
import type { MediaReleaseItem, Season } from "./types";

export interface SeasonTab {
  key: string;
  seasonNumber: number | null;
  label: string;
  /** Provider season (its `episodes` may be empty when they load lazily). */
  season: Season | null;
  /** Season-level downloads, best quality first. */
  packs: MediaReleaseItem[];
}

export function seasonLabel(seasonNumber: number, name?: string): string {
  if (name && name.trim()) return name.trim();
  return seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;
}

export function buildSeasonTabs(seasons: readonly Season[], releases: readonly MediaReleaseItem[] = []): SeasonTab[] {
  const bySeason = new Map<number, SeasonTab>();

  for (const season of seasons) {
    if (bySeason.has(season.seasonNumber)) continue;
    bySeason.set(season.seasonNumber, {
      key: `s${season.seasonNumber}`,
      seasonNumber: season.seasonNumber,
      label: seasonLabel(season.seasonNumber, season.name),
      season,
      packs: [],
    });
  }

  const unassigned: MediaReleaseItem[] = [];
  for (const release of releases) {
    const n = release.seasonNumber;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      unassigned.push(release);
      continue;
    }
    let tab = bySeason.get(n);
    if (!tab) {
      tab = { key: `s${n}`, seasonNumber: n, label: seasonLabel(n), season: null, packs: [] };
      bySeason.set(n, tab);
    }
    tab.packs.push(release);
  }

  const tabs = [...bySeason.values()]
    .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0))
    .map((tab) => ({ ...tab, packs: sortByQuality(tab.packs) }));

  if (unassigned.length) {
    tabs.push({ key: "other", seasonNumber: null, label: "More downloads", season: null, packs: sortByQuality(unassigned) });
  }
  return tabs;
}

/** `S02E05`. */
export function episodeCode(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}
