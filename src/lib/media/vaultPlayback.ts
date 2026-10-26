/**
 * Turning a play-info payload into something a browser can actually play —
 * **isomorphic**, because this is now done in the user's browser.
 *
 * The catalogue answers `play-info/v2` with one entry per stream: a DASH
 * manifest URL (recovered from its signed cookie) and the cookie itself:
 *
 *   `Edge-Cache-Cookie=urlprefix=<base64 url>:sign=…:t=…`
 *
 * A browser cannot attach that cookie to a cross-origin manifest or segment
 * request (`Cookie` is a forbidden header), so those bytes have to leave through
 * this app's relay. Everything *around* that is client-side: the manifest URL is
 * derived from the payload, the relay token is built here, and no server call is
 * needed to know what to play. That is what removes the old
 * `POST /api/media/exclusive/playback` hop and its 440s.
 *
 * What stays playable without any relay:
 *   - direct MP4 / WebM / HLS files (`resource` listings) — straight from the CDN;
 *   - any DASH manifest that carries **no** signed cookie — served as-is.
 */

import type { MediaReleaseItem, MediaMirror, PlaybackSource } from "./types";
import { buildVaultStreamUrl, unwrapVaultStreamUrl, VAULT_STREAM_PATH } from "./vaultStreamToken";

/** Whether a mirror needs the CDN's signed cookie (i.e. a relay) to be fetched. */
export function mirrorNeedsRelay(mirror: MediaMirror): boolean {
  const cookie = (mirror.headers ?? []).find(([name]) => name.toLowerCase() === "cookie");
  return Boolean(cookie && cookie[1].trim());
}

/** A DASH manifest, by URL shape (play-info's `container` is the file format, not DASH). */
export function isDashManifestUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  return path.endsWith(".mpd") || path.includes("/dash/");
}

/** The directory a manifest lives in — DASH segments sit beside it. */
export function manifestDirectory(url: string): string | undefined {
  const clean = url.split(/[?#]/)[0];
  const slash = clean.lastIndexOf("/");
  return slash > "https://".length ? clean.slice(0, slash + 1) : undefined;
}

/**
 * One source per DASH manifest, preferring the zero-relay path when it can work.
 *
 * `origin` is required for the relayed variant: Shaka needs a scheme, and the
 * relay lives on this app's origin.
 */
export function dashPlaybackSources(
  releases: readonly MediaReleaseItem[],
  options: { origin?: string | null; note?: string } = {}
): PlaybackSource[] {
  const out: PlaybackSource[] = [];
  const seen = new Set<string>();

  for (const release of releases) {
    for (const mirror of release.mirrors) {
      const manifest = mirror.shortUrl?.trim();
      if (!manifest || !/^https?:\/\//i.test(manifest)) continue;
      if (!isDashManifestUrl(manifest)) continue;
      if (seen.has(manifest)) continue;
      seen.add(manifest);

      const label = release.quality ? `${release.quality} DASH` : "Adaptive DASH";
      const needsRelay = mirrorNeedsRelay(mirror);

      if (!needsRelay) {
        // No cookie: the browser can fetch the manifest and its segments itself.
        out.push({
          url: manifest,
          type: "dash",
          label,
          container: "DASH",
          note: options.note ?? "Adaptive stream fetched directly from the CDN — no relay.",
        });
        continue;
      }

      out.push({
        url: buildVaultStreamUrl(manifest, mirror.headers, options.origin, manifestDirectory(manifest)),
        type: "dash",
        label,
        container: "DASH",
        note: "Adaptive stream relayed by Sidify to keep the CDN's signed authorisation.",
      });
    }
  }

  return out;
}

/** Whether a playback URL already points at this app's byte relay. */
export function isRelayedSource(url: string): boolean {
  return url.includes(VAULT_STREAM_PATH);
}

/** The upstream URL behind a relayed source, when it is one. */
export function upstreamOfSource(url: string): string | null {
  return unwrapVaultStreamUrl(url);
}

/**
 * Merges DASH sources with the direct files a release list already carries,
 * dropping duplicates by URL. DASH first: one adaptive source beats N files.
 */
export function mergePlaybackSources(dash: PlaybackSource[], files: PlaybackSource[]): PlaybackSource[] {
  const seen = new Set<string>();
  const out: PlaybackSource[] = [];
  for (const source of [...dash, ...files]) {
    const key = source.url.split("#")[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

/**
 * Moves episode-specific files from a flat release list onto their episodes.
 *
 * A series' `resource` listing is flat: one row per file, tagged with `se`/`ep`.
 * The detail page renders episodes, so those rows belong on the episode they
 * name — otherwise they would show up as the *series'* downloads, and the
 * episode rows would offer nothing to play.
 *
 * Returns the releases that are not tied to a single episode (season packs,
 * whole-series files), which stay at the title level. Costs no extra request:
 * it is the same flat listing the app already fetches.
 */
export function applyEpisodeReleases(
  seasons: readonly { seasonNumber: number; episodes: readonly { episodeNumber: number; releases?: MediaReleaseItem[] }[] }[],
  releases: readonly MediaReleaseItem[]
): MediaReleaseItem[] {
  const kept: MediaReleaseItem[] = [];

  for (const release of releases) {
    const season = release.seasonNumber;
    const episode = release.episodeNumber;
    if (season === undefined || episode === undefined) {
      kept.push(release);
      continue;
    }

    const match = seasons
      .find((entry) => entry.seasonNumber === season)
      ?.episodes.find((entry) => entry.episodeNumber === episode);

    if (!match) {
      // No such episode in the payload: keep the file visible at title level
      // rather than silently dropping it.
      kept.push(release);
      continue;
    }

    match.releases = [...(match.releases ?? []), release];
  }

  return kept;
}
