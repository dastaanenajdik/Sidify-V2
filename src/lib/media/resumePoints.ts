/**
 * "Continue from where you stopped" for Try Play: one playback position per item, kept in
 * this browser (localStorage). Keys are `WatchTarget.key` values — `movie-<slug>` for a
 * movie, `<slug>-s2e5` for an episode — so a position survives quality changes, reloads
 * and new sessions. Only seconds and timestamps are stored: never URLs or tokens.
 *
 * Framework-free so the Node test runner covers it; the React side lives in
 * `components/media/useResumePoint.ts`.
 */

export const RESUME_STORAGE_KEY = "sidify-media-resume-v1";
/** Positions earlier than this aren't worth resuming. */
export const MIN_RESUME_SECONDS = 10;
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;
/** Fired on `window` whenever a position is written or cleared (labels re-read it). */
export const RESUME_EVENT = "sidify-resume-change";

export interface ResumePoint {
  /** Position in seconds. */
  t: number;
  /** Duration in seconds, when known. */
  d?: number;
  /** When it was saved (ms since epoch). */
  at: number;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The last ~3% (at least 30 s) counts as finished — credits — so next time starts over. */
export function isNearEnd(t: number, d?: number): boolean {
  if (!d || !Number.isFinite(d) || d <= 0) return false;
  return t >= d - Math.max(30, d * 0.03);
}

/** Where to resume from, or `null` (too early, finished, stale or invalid). */
export function resumePosition(point: ResumePoint | null | undefined, now = Date.now()): number | null {
  if (!point || !Number.isFinite(point.t) || !Number.isFinite(point.at)) return null;
  if (now - point.at > MAX_AGE_MS) return null;
  if (point.t < MIN_RESUME_SECONDS) return null;
  if (isNearEnd(point.t, point.d)) return null;
  return point.t;
}

function readAll(storage: StorageLike | null): Record<string, ResumePoint> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(RESUME_STORAGE_KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, ResumePoint> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const point = value as Partial<ResumePoint> | null;
      if (point && typeof point.t === "number" && typeof point.at === "number") {
        out[key] = { t: point.t, at: point.at, ...(typeof point.d === "number" ? { d: point.d } : {}) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(storage: StorageLike | null, points: Record<string, ResumePoint>, now: number): void {
  if (!storage) return;
  const kept = Object.entries(points)
    .filter(([, point]) => now - point.at <= MAX_AGE_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_ENTRIES);
  try {
    storage.setItem(RESUME_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or blocked — resuming is a convenience */
  }
}

function notify(key: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(RESUME_EVENT, { detail: { key } }));
  } catch {
    /* ignore */
  }
}

export function loadResumePoint(key: string, storage: StorageLike | null = defaultStorage()): ResumePoint | null {
  if (!key) return null;
  return readAll(storage)[key] ?? null;
}

/**
 * Remember `t` for `key`. Positions under MIN_RESUME_SECONDS or near the end clear the entry
 * instead, so a finished movie starts from the beginning next time.
 */
export function saveResumePoint(
  key: string,
  t: number,
  d?: number,
  storage: StorageLike | null = defaultStorage(),
  now = Date.now()
): void {
  if (!key || !Number.isFinite(t) || t < 0) return;
  const points = readAll(storage);
  const duration = d && Number.isFinite(d) && d > 0 ? d : undefined;
  if (t < MIN_RESUME_SECONDS || isNearEnd(t, duration)) {
    if (!(key in points)) return;
    delete points[key];
  } else {
    points[key] = { t: Math.round(t * 10) / 10, at: now, ...(duration ? { d: Math.round(duration) } : {}) };
  }
  writeAll(storage, points, now);
  notify(key);
}

export function clearResumePoint(key: string, storage: StorageLike | null = defaultStorage(), now = Date.now()): void {
  const points = readAll(storage);
  if (!(key in points)) return;
  delete points[key];
  writeAll(storage, points, now);
  notify(key);
}

/** `23:10`, `1:02:03`. */
export function formatPlaybackTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
