"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "@/store/player";
import type { LyricLine } from "./lyrics";
import { advanceMediaClock, needsResync } from "./lyricsClock";

export { advanceMediaClock, needsResync, RESYNC_THRESHOLD_MS } from "./lyricsClock";

/* ------------------------------------------------------------------ */
/*  Client-side lyrics helpers.                                        */
/*                                                                     */
/*  `useLyricsLookup` owns one fetch per (title, artist) search, with   */
/*  retry + abort semantics shared by the player's lyrics panel and     */
/*  the Library → Lyrics finder.                                        */
/*                                                                     */
/*  `useSmoothPosition` turns the engine's ~4.5 Hz store updates into   */
/*  a 60 fps media clock, so synced highlighting glides instead of      */
/*  stepping (and keeps time at 0.5x–2x playback speed).                */
/* ------------------------------------------------------------------ */

export interface LyricsLookup {
  title: string;
  artist: string;
  /** Bumped by `retry()` so an identical search can be re-run. */
  attempt: number;
  /** Known track length in ms; sent to the API to disambiguate same-title songs. */
  durationMs: number;
}

export interface LyricsLookupState {
  /** A request is in flight. */
  loading: boolean;
  /** At least one search has been attempted — false while a finder sits idle. */
  started: boolean;
  /** Plain, copy-friendly lyrics ("" for instrumentals, null until loaded). */
  lyrics: string | null;
  /** Time-stamped lines; empty when the provider only had plain lyrics. */
  lines: LyricLine[];
  source: string;
  instrumental: boolean;
  /** Human-readable failure reason (empty while loading or on success). */
  message: string;
}

const IDLE: LyricsLookupState = {
  loading: false,
  started: false,
  lyrics: null,
  lines: [],
  source: "",
  instrumental: false,
  message: "",
};

/** Defensive parse: never trust the shape of a cached/proxied JSON body. */
function readLines(value: unknown): LyricLine[] {
  if (!Array.isArray(value)) return [];
  const lines: LyricLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { startMs?: unknown; text?: unknown };
    if (typeof raw.text !== "string" || !raw.text.trim()) continue;
    const startMs = Number(raw.startMs);
    lines.push({ startMs: Number.isFinite(startMs) && startMs > 0 ? startMs : 0, text: raw.text.trim() });
  }
  return lines.sort((a, b) => a.startMs - b.startMs);
}

const LOADING: LyricsLookupState = { ...IDLE, loading: true, started: true };

export function useLyricsLookup(initialTitle: string, initialArtist: string, durationMs = 0) {
  const [lookup, setLookup] = useState<LyricsLookup>({ title: initialTitle, artist: initialArtist, attempt: 0, durationMs });
  // A panel that mounts with a track is already fetching; a finder with an empty
  // title stays idle so its empty state is shown instead of a spinner.
  const [state, setState] = useState<LyricsLookupState>(initialTitle.trim() ? LOADING : IDLE);

  /** Start a new search (used by the manual "wrong match?" form and Retry). */
  const search = useCallback((title: string, artist: string) => {
    setState(title.trim() ? LOADING : IDLE);
    setLookup((value) => ({ title: title.trim(), artist: artist.trim(), attempt: value.attempt + 1, durationMs: value.durationMs }));
  }, []);

  const retry = useCallback(() => {
    setState(LOADING);
    setLookup((value) => ({ ...value, attempt: value.attempt + 1 }));
  }, []);

  useEffect(() => {
    if (!lookup.title.trim()) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ title: lookup.title, artist: lookup.artist });
    if (lookup.durationMs > 0) params.set("duration", String(lookup.durationMs / 1000));

    fetch(`/api/lyrics?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          success?: boolean;
          lyrics?: string;
          lines?: unknown;
          source?: string;
          instrumental?: boolean;
          message?: string;
        };
        if (!response.ok || !data.success) throw new Error(data.message || "Unable to load lyrics. Please retry.");
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          started: true,
          lyrics: data.lyrics || "",
          lines: readLines(data.lines),
          source: data.source || "",
          instrumental: !!data.instrumental,
          message: "",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((value) => ({
          ...value,
          loading: false,
          started: true,
          message: error instanceof Error ? error.message : "Unable to load lyrics. Please retry.",
        }));
      });

    return () => controller.abort();
  }, [lookup]);

  return { ...state, lookup, search, retry };
}

/**
 * Media-time clock for synced lyrics: extrapolates between the engine's coarse
 * store updates with `performance.now()` + playback speed, and snaps back to the
 * reported position on seeks, pauses and track changes (see `lyricsClock.ts`).
 */
export function useSmoothPosition(): number {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const [displayMs, setDisplayMs] = useState(positionMs);
  const clock = useRef(positionMs);

  useEffect(() => {
    if (needsResync(clock.current, positionMs, isPlaying)) {
      clock.current = positionMs;
      setDisplayMs(positionMs);
    }
  }, [positionMs, isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      clock.current = advanceMediaClock(clock.current, now - last, usePlayer.getState().speed || 1, durationMs);
      last = now;
      setDisplayMs(clock.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, durationMs]);

  return displayMs;
}

/** Stable index of the line to light up, recomputed only when it actually changes. */
export function useActiveLine(lines: LyricLine[], positionMs: number): number {
  return useMemo(() => {
    if (!lines.length || positionMs < lines[0].startMs) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].startMs <= positionMs) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }, [lines, positionMs]);
}
