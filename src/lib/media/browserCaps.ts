/**
 * Browser media capability probe — what the engine *reports* via `canPlayType`.
 *
 * `canPlayType` answers "probably" / "maybe" / "" for a MIME type + codecs string. It is
 * a self-report, not a playback test: real playback events (`loadedmetadata`, `error`,
 * `videoWidth`) decide whether a file actually works. Results are only used for hedged
 * hints in the UI.
 */

import type { BrowserCapabilities } from "./releaseHints";

export type CanPlayTypeProbe = Pick<HTMLMediaElement, "canPlayType">;

const PROBES = {
  h264: ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.42E01E"'],
  hevc: ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="hvc1.1.6.L93.B0"'],
  av1: ['video/mp4; codecs="av01.0.05M.08"'],
  vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'],
  aac: ['audio/mp4; codecs="mp4a.40.2"'],
  ac3: ['audio/mp4; codecs="ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"'],
  opus: ['audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"'],
} as const;

function supports(probe: CanPlayTypeProbe, types: readonly string[]): boolean {
  return types.some((type) => {
    try {
      return Boolean(probe.canPlayType(type));
    } catch {
      return false;
    }
  });
}

/** Probe a media element (or anything with `canPlayType`). Returns `null` off-DOM. */
export function probeBrowserCapabilities(probe?: CanPlayTypeProbe | null): BrowserCapabilities | null {
  let target = probe ?? null;
  if (!target) {
    if (typeof document === "undefined") return null;
    try {
      target = document.createElement("video");
    } catch {
      return null;
    }
  }

  let mkv: true | null = null;
  try {
    // Older Chromium answered "" yet still played MKV, so "" only means "unknown"
    // unless the engine positively reports support.
    mkv = target.canPlayType("video/x-matroska") ? true : null;
  } catch {
    mkv = null;
  }

  return {
    h264: supports(target, PROBES.h264),
    hevc: supports(target, PROBES.hevc),
    av1: supports(target, PROBES.av1),
    vp9: supports(target, PROBES.vp9),
    aac: supports(target, PROBES.aac),
    ac3: supports(target, PROBES.ac3),
    eac3: supports(target, PROBES.eac3),
    opus: supports(target, PROBES.opus),
    mkv,
  };
}
