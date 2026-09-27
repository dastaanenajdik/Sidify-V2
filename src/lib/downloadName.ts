/**
 * File naming for downloads — shared by the `/api/stream?download=1` attachment header
 * and the in-browser "Save to device" flow, so both produce the same honest file name.
 *
 * The extension always reflects the container we really serve (AAC-in-MP4 → `.m4a`,
 * Opus-in-WebM → `.webm`). Renaming to `.mp3` would produce files many players refuse.
 */

export function audioExtension(mime: string | null | undefined): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("webm") || m.includes("opus")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "m4a";
}

/** `Title - Artist.m4a`, stripped of characters no filesystem accepts. */
export function downloadFileName(title: string, artist: string, mime: string | null | undefined): string {
  const clean = (s: string) =>
    (s || "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const base = [clean(title), clean(artist)].filter(Boolean).join(" - ").slice(0, 120) || "audio";
  return `${base}.${audioExtension(mime)}`;
}

/** RFC 6266 header: ASCII fallback plus a UTF-8 `filename*` so Hindi/Unicode titles survive. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
