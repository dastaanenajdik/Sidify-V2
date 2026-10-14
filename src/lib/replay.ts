import type { PlayEntry } from "./playLog";

/** Replay — listening stats computed from the local play log. */

export type ReplayPeriod = "month" | "year" | "all";

export interface ReplaySong {
  entry: PlayEntry;
  plays: number;
  ms: number;
}

export interface ReplayArtist {
  name: string;
  artistId?: string;
  artwork: string;
  plays: number;
  ms: number;
}

export interface ReplayStats {
  minutes: number;
  plays: number;
  songs: ReplaySong[];
  artists: ReplayArtist[];
  byHour: number[];
  activeDays: number;
  firstAt: number | null;
  streak: number;
}

export function periodStart(period: ReplayPeriod, now = new Date()): number {
  if (period === "all") return 0;
  if (period === "year") return new Date(now.getFullYear(), 0, 1).getTime();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Heard time for an entry: what was measured, or most of the song for older entries. */
function heard(e: PlayEntry): number {
  if (e.ms > 0) return e.ms;
  return 0;
}

export function computeReplay(all: PlayEntry[], period: ReplayPeriod, now = new Date()): ReplayStats {
  const from = periodStart(period, now);
  const entries = all.filter((e) => e.at >= from && (heard(e) >= 20_000 || (e.d > 0 && heard(e) >= e.d * 0.5)));
  const songs = new Map<string, ReplaySong>();
  const artists = new Map<string, ReplayArtist>();
  const byHour = new Array(24).fill(0) as number[];
  const days = new Set<string>();
  let ms = 0;

  for (const e of entries) {
    const h = heard(e);
    ms += h;
    const s = songs.get(e.id);
    if (s) {
      s.plays++;
      s.ms += h;
      s.entry = e;
    } else songs.set(e.id, { entry: e, plays: 1, ms: h });
    const key = (e.aid || e.a || "").toLowerCase();
    if (key) {
      const a = artists.get(key);
      if (a) {
        a.plays++;
        a.ms += h;
      } else artists.set(key, { name: e.a, artistId: e.aid, artwork: e.art, plays: 1, ms: h });
    }
    byHour[new Date(e.at).getHours()] += h;
    days.add(dayKey(e.at));
  }

  // Current streak: consecutive days up to today (or yesterday) with listening.
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const rank = <T extends { plays: number; ms: number }>(a: T, b: T) => b.plays - a.plays || b.ms - a.ms;
  return {
    minutes: Math.round(ms / 60_000),
    plays: entries.length,
    songs: [...songs.values()].sort(rank),
    artists: [...artists.values()].sort(rank),
    byHour,
    activeDays: days.size,
    firstAt: all.length ? all[0].at : null,
    streak,
  };
}
