/**
 * Authorized playback sources — operator supplied only.
 *
 * TMDb (and any metadata-only provider) does not license streaming, and this project
 * never scrapes one. The only way a title becomes playable is:
 *   1. a licensed provider adapter returns it from `getPlaybackSources`, or
 *   2. the operator lists it in `MEDIA_PLAYBACK_MANIFEST` (JSON in an env var), e.g.
 *
 *      {"movie/603692-john-wick":[
 *        {"url":"https://cdn.example.com/john-wick/master.m3u8","type":"hls","label":"HD"}
 *      ]}
 *
 * Non-HTTPS URLs, unknown types and malformed entries are dropped, so the manifest
 * can never inject a plain-http player or a local path.
 */

import type { MediaKind, PlaybackSource } from "./types";

export function sanitizePlaybackSource(entry: unknown): PlaybackSource | null {
  if (!entry || typeof entry !== "object") return null;
  const { url, type, label, note } = entry as { url?: unknown; type?: unknown; label?: unknown; note?: unknown };
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return null;
  const kind: PlaybackSource["type"] | null =
    type === "hls" || type === "mp4" || type === "embed"
      ? type
      : /\.m3u8(\?|$)/i.test(url)
        ? "hls"
        : /\.mp4(\?|$)/i.test(url)
          ? "mp4"
          : null;
  if (!kind) return null;
  const source: PlaybackSource = {
    url,
    type: kind,
    label: typeof label === "string" ? label.slice(0, 40) : undefined,
  };
  if (typeof note === "string" && note.trim()) source.note = note.slice(0, 200);
  return source;
}

export function parsePlaybackManifest(raw: string | undefined): Record<string, PlaybackSource[]> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PlaybackSource[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const sources = value
        .map(sanitizePlaybackSource)
        .filter((source): source is PlaybackSource => source !== null);
      if (sources.length) out[key] = sources;
    }
    return out;
  } catch {
    console.warn("[media] MEDIA_PLAYBACK_MANIFEST is not valid JSON — ignoring it");
    return {};
  }
}

export function playbackManifest(): Record<string, PlaybackSource[]> {
  return parsePlaybackManifest(process.env.MEDIA_PLAYBACK_MANIFEST);
}

export function manifestSources(kind: MediaKind, slug: string): PlaybackSource[] {
  return playbackManifest()[`${kind}/${slug}`] ?? [];
}

export function dedupeSources(sources: PlaybackSource[]): PlaybackSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => (seen.has(source.url) ? false : (seen.add(source.url), true)));
}
