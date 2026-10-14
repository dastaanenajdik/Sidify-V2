"use client";

import type { Track } from "./types";

/**
 * Local play log — the raw material for Replay (top songs, artists and
 * minutes listened). One entry per started play, with the milliseconds that
 * were actually heard accumulated onto it while it plays. Lives in
 * localStorage only; nothing leaves the device.
 */

export interface PlayEntry {
  /** track id */
  id: string;
  vid?: string;
  /** title */
  t: string;
  /** artist */
  a: string;
  aid?: string;
  /** album */
  al?: string;
  alid?: string;
  art: string;
  /** track length in ms */
  d: number;
  /** started at (epoch ms) */
  at: number;
  /** listened ms */
  ms: number;
}

const KEY = "sidify-playlog";
const MAX = 4000;

let entries: PlayEntry[] | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): PlayEntry[] {
  if (entries) return entries;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as PlayEntry[]) : [];
    entries = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    entries = [];
  }
  return entries;
}

function persistSoon() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushPlayLog();
  }, 4000);
}

export function flushPlayLog() {
  if (!dirty || !entries) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
    dirty = false;
  } catch {
    /* storage full — keep in memory */
  }
}

export function logPlay(track: Track) {
  const list = load();
  list.push({
    id: track.id,
    vid: track.videoId,
    t: track.title,
    a: track.artist,
    aid: track.artistId,
    al: track.album,
    alid: track.albumId,
    art: track.artwork,
    d: track.durationMs || 0,
    at: Date.now(),
    ms: 0,
  });
  if (list.length > MAX) list.splice(0, list.length - MAX);
  persistSoon();
}

/** Adds heard time to the newest entry when it belongs to `trackId`. */
export function addListened(trackId: string, ms: number) {
  if (!(ms > 0)) return;
  const list = load();
  const last = list[list.length - 1];
  if (!last || last.id !== trackId) return;
  const cap = last.d > 0 ? last.d * 1.05 : Number.POSITIVE_INFINITY;
  last.ms = Math.min(cap, last.ms + ms);
  persistSoon();
}

export function readPlayLog(): PlayEntry[] {
  return [...load()];
}

export function clearPlayLog() {
  entries = [];
  dirty = true;
  flushPlayLog();
}

/** Back an entry out into a playable Track. */
export function entryTrack(e: PlayEntry): Track {
  return {
    id: e.id,
    videoId: e.vid,
    title: e.t,
    artist: e.a,
    artistId: e.aid,
    album: e.al,
    albumId: e.alid,
    artwork: e.art,
    previewUrl: "",
    durationMs: e.d,
  };
}
