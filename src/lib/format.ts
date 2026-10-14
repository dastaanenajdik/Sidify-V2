import type { Track } from "./types";

/** Upscale iTunes artwork (100x100bb -> requested size) */
export function upscaleArtwork(url: string, size = 600): string {
  if (!url) return url;
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

/**
 * Artwork at roughly the size it is drawn.
 *
 *  - YouTube Music art (`lh3.googleusercontent.com`, `yt3.ggpht.com`) takes a
 *    size suffix, so small tiles get small files and the player gets a sharp one.
 *  - Video thumbnails (`i.ytimg.com`) come in fixed renditions; rows and tiles
 *    use the 320px one (16:9 with no letterbox bars, so a centre crop is clean),
 *    everything bigger keeps the full-size frame and its fallback chain.
 */
export function art(url: string | undefined | null, size = 300): string {
  if (!url) return "";
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    const px = Math.max(60, Math.min(1200, Math.round(size)));
    return `${url.replace(/=[^/]*$/, "")}=w${px}-h${px}-l90-rj`;
  }
  const yt = url.match(/^https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//);
  if (yt) {
    if (size <= 200) return `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg`;
    return url;
  }
  return upscaleArtwork(url, Math.min(1200, Math.max(100, Math.round(size))));
}

export function formatTime(ms: number): string {
  if (!ms || isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? (date.match(/\d{4}/)?.[0] ?? "") : d.getFullYear().toString();
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** "3 min ago", "yesterday", "12 Mar". */
export function timeAgo(at: number | string | Date): string {
  const t = typeof at === "number" ? at : new Date(at).getTime();
  const diff = Date.now() - t;
  if (!Number.isFinite(diff)) return "";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Good morning / afternoon / evening for the Home header. */
export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Fisher–Yates copy. */
export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** De-duplicates tracks by id, keeping the first occurrence. */
export function uniqueTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (t?.id && !seen.has(t.id) ? (seen.add(t.id), true) : false));
}
