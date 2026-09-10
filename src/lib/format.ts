import type { Track } from "./types";

/** Upscale iTunes artwork (100x100bb -> requested size) */
export function upscaleArtwork(url: string, size = 600): string {
  if (!url) return url;
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

export function formatTime(ms: number): string {
  if (!ms || isNaN(ms)) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatSecs(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function totalDuration(tracks: Track[]): string {
  const ms = tracks.reduce((a, t) => a + (t.durationMs || 0), 0);
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} hr ${mins % 60} min`;
}

export function yearOf(date?: string): string {
  return date ? new Date(date).getFullYear().toString() : "";
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
