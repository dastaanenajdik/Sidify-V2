/**
 * Resolving direct stream links across qualities for "Play with VLC".
 *
 * Why resolve BEFORE showing clickable VLC links instead of resolving inside a button tap:
 *   1. Mobile browsers (Android Chrome, iOS Safari) only allow `intent:` and custom-scheme
 *      navigations inside a synchronous user gesture. Waiting on `fetch("/api/media/resolve")`
 *      expires transient user activation so `anchor.click()` is silently dropped.
 *   2. A single blind auto-pick has no fallback if one server is down, quota-limited or
 *      oversized for the connection. Loading ALL qualities and ALL their resolved server
 *      links up front lets every row render as a real `<a href>` — whichever link the user
 *      taps opens VLC and begins streaming right away.
 */

import { MediaApiError, mediaApi } from "./client";
import { redactUrl, reportMediaDiagnostic } from "./diagnostics";
import {
  externalPlayerLink,
  externalPlayerLinks,
  externalPlayerReleases,
  landingPageUrl,
  type ExternalPlayerLink,
} from "./playbackPlan";
import type { MediaReleaseItem, MirrorResolveResult } from "./types";

/** How many qualities resolve concurrently when the VLC sheet opens. */
export const DEFAULT_VLC_RESOLVE_CONCURRENCY = 3;

/** How many qualities single-stream helper resolves before giving up. */
export const MAX_VLC_RELEASES_TRIED = 3;

export type ResolveMirrorFn = (params: {
  url: string;
  fileName?: string;
  label?: string;
  refresh?: boolean;
  signal?: AbortSignal;
}) => Promise<MirrorResolveResult>;

export type ReleaseStreamResolution =
  | { status: "ready"; links: ExternalPlayerLink[] }
  | { status: "manual"; url: string }
  | { status: "error"; manualUrl?: string }
  | { status: "aborted" };

export interface ExternalStream extends ExternalPlayerLink {
  quality?: string;
}

/**
 * Resolve all streamable server links for ONE quality release, falling back across mirrors
 * until one yields direct links (and skipping `blocked` access-controlled mirrors).
 */
export async function resolveReleaseStreams(
  release: MediaReleaseItem,
  options: {
    signal?: AbortSignal;
    label?: string;
    refresh?: boolean;
    resolve?: ResolveMirrorFn;
  } = {}
): Promise<ReleaseStreamResolution> {
  const { signal, label, refresh, resolve = mediaApi.resolveMirror } = options;
  let landingUrl: string | undefined;
  let fallbackUrl: string | undefined;

  for (const mirror of release.mirrors) {
    if (signal?.aborted) return { status: "aborted" };
    try {
      const result = await resolve({
        url: mirror.shortUrl,
        fileName: release.fileName,
        label: label || release.title,
        refresh,
        signal,
      });
      if (signal?.aborted) return { status: "aborted" };

      if (result.status === "blocked") {
        fallbackUrl ??= result.externalFallbackUrl;
        reportMediaDiagnostic("Play with VLC: mirror is access-controlled", {
          stage: "resolve-result",
          quality: release.quality,
          mirror: redactUrl(mirror.shortUrl),
          reason: result.reason,
        });
        continue;
      }

      const links = externalPlayerLinks(result.links);
      if (links.length > 0) {
        return { status: "ready", links };
      }

      landingUrl ??= landingPageUrl(result);
      fallbackUrl ??= result.externalFallbackUrl;
      reportMediaDiagnostic("Play with VLC: mirror gave no streamable link", {
        stage: "resolve-result",
        quality: release.quality,
        mirror: redactUrl(mirror.shortUrl),
        status: result.status,
        reason: result.reason,
        links: result.links.length,
      });
    } catch (err) {
      if (signal?.aborted) return { status: "aborted" };
      reportMediaDiagnostic("Play with VLC: mirror resolve failed", {
        stage: "resolve-api",
        quality: release.quality,
        mirror: redactUrl(mirror.shortUrl),
        httpStatus: err instanceof MediaApiError ? err.status : undefined,
        code: err instanceof MediaApiError ? err.code : (err as Error)?.name,
      });
    }
  }

  if (landingUrl) return { status: "manual", url: landingUrl };
  return { status: "error", manualUrl: fallbackUrl ?? release.mirrors[0]?.shortUrl };
}

/**
 * Resolve ALL streamable quality releases (`externalPlayerReleases`) concurrently with
 * bounded concurrency, streaming results back via `onResult` as each quality completes.
 */
export async function resolveAllReleaseStreams(
  releases: readonly MediaReleaseItem[],
  options: {
    signal?: AbortSignal;
    label?: string;
    concurrency?: number;
    resolve?: ResolveMirrorFn;
    onStart?: (release: MediaReleaseItem) => void;
    onResult?: (release: MediaReleaseItem, result: ReleaseStreamResolution) => void;
  } = {}
): Promise<Map<string, ReleaseStreamResolution>> {
  const { signal, label, resolve, onStart, onResult } = options;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_VLC_RESOLVE_CONCURRENCY);
  const queue = externalPlayerReleases(releases);
  const results = new Map<string, ReleaseStreamResolution>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      if (signal?.aborted) return;
      const release = queue[cursor++];
      onStart?.(release);
      const outcome = await resolveReleaseStreams(release, { signal, label, resolve });
      if (signal?.aborted || outcome.status === "aborted") return;
      results.set(release.id, outcome);
      onResult?.(release, outcome);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return results;
}

/**
 * Resolve the single highest-priority link across `releases` (kept for programmatic callers).
 */
export async function resolveExternalStream(
  releases: readonly MediaReleaseItem[],
  options: { signal?: AbortSignal; label?: string; maxReleases?: number; resolve?: ResolveMirrorFn } = {}
): Promise<ExternalStream | null> {
  const { signal, label, resolve = mediaApi.resolveMirror } = options;
  const queue = externalPlayerReleases(releases as MediaReleaseItem[]).slice(
    0,
    options.maxReleases ?? MAX_VLC_RELEASES_TRIED
  );

  for (const release of queue) {
    for (const mirror of release.mirrors) {
      if (signal?.aborted) return null;
      try {
        const result = await resolve({
          url: mirror.shortUrl,
          fileName: release.fileName,
          label: label || release.title,
          signal,
        });
        if (signal?.aborted) return null;
        if (result.status === "blocked") continue;
        const link = externalPlayerLink(result.links);
        if (link) return { ...link, quality: release.quality };
      } catch {
        if (signal?.aborted) return null;
      }
    }
  }
  return null;
}
