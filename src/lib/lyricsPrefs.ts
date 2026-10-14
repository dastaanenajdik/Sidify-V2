"use client";

/** Per-song lyric timing offsets (ms), for LRC files that run early or late. */

const KEY = "sidify-lyrics-offsets";

function readAll(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

export function getLyricsOffset(trackId: string): number {
  const v = readAll()[trackId];
  return Number.isFinite(v) ? v : 0;
}

export function setLyricsOffset(trackId: string, ms: number) {
  try {
    const all = readAll();
    if (!ms) delete all[trackId];
    else all[trackId] = Math.max(-10_000, Math.min(10_000, Math.round(ms)));
    const keys = Object.keys(all);
    // Keep the map small.
    for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete all[k];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
