/**
 * "Play with VLC" needs one direct link, and it needs it fast.
 *
 * A row on a title page only carries mirror short-links, so the link has to be resolved
 * first — the same `/api/media/resolve` call the player makes, minus the browser playback
 * attempts. The rules that matter here:
 *   - Qualities are tried best-first and only `MAX_RELEASES_TRIED` of them, so one tap is
 *     a bounded number of upstream hops (the resolve route caches, so a second tap on the
 *     same item is instant).
 *   - Every mirror of a quality is tried until one gives a direct file: a dead mirror must
 *     not stop the button from working.
 *   - A mirror that comes back `blocked` (CAPTCHA / 401–403) is skipped, never retried.
 *   - Nothing about the failure is shown as an error to the user beyond "try Download":
 *     details go to the console through `reportMediaDiagnostic`.
 */

import { MediaApiError, mediaApi } from "./client";
import { redactUrl, reportMediaDiagnostic } from "./diagnostics";
import { externalPlayerLink, externalPlayerReleases, type ExternalPlayerLink } from "./playbackPlan";
import type { MediaReleaseItem } from "./types";

/** How many qualities one tap may resolve before giving up (each tries all its mirrors). */
export const MAX_VLC_RELEASES_TRIED = 3;

export interface ExternalStream extends ExternalPlayerLink {
  quality?: string;
}

/**
 * Resolve the best link a player app can stream for these releases.
 * `null` means "no direct link right now" — the caller keeps Download as the way in.
 */
export async function resolveExternalStream(
  releases: readonly MediaReleaseItem[],
  options: { signal?: AbortSignal; label?: string; maxReleases?: number } = {}
): Promise<ExternalStream | null> {
  const { signal, label } = options;
  const queue = externalPlayerReleases(releases as MediaReleaseItem[]).slice(0, options.maxReleases ?? MAX_VLC_RELEASES_TRIED);

  for (const release of queue) {
    for (const mirror of release.mirrors) {
      if (signal?.aborted) return null;
      try {
        const result = await mediaApi.resolveMirror({
          url: mirror.shortUrl,
          fileName: release.fileName,
          label: label || release.title,
          signal,
        });
        if (signal?.aborted) return null;
        if (result.status === "blocked") {
          reportMediaDiagnostic("Play with VLC: mirror is access-controlled", {
            stage: "resolve-result",
            quality: release.quality,
            mirror: redactUrl(mirror.shortUrl),
            reason: result.reason,
          });
          continue;
        }
        const link = externalPlayerLink(result.links);
        if (link) return { ...link, quality: release.quality };
        reportMediaDiagnostic("Play with VLC: mirror gave no streamable link", {
          stage: "resolve-result",
          quality: release.quality,
          mirror: redactUrl(mirror.shortUrl),
          status: result.status,
          reason: result.reason,
          links: result.links.length,
        });
      } catch (err) {
        if (signal?.aborted) return null;
        reportMediaDiagnostic("Play with VLC: mirror resolve failed", {
          stage: "resolve-api",
          quality: release.quality,
          mirror: redactUrl(mirror.shortUrl),
          httpStatus: err instanceof MediaApiError ? err.status : undefined,
          code: err instanceof MediaApiError ? err.code : (err as Error)?.name,
        });
      }
    }
  }
  return null;
}
