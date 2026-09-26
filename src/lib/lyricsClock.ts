/* ------------------------------------------------------------------ */
/*  Media-time clock maths for synced lyrics.                          */
/*                                                                     */
/*  Pure + framework-free on purpose: the audio engine only publishes   */
/*  `positionMs` every ~220–240 ms, which is far too coarse to drive a  */
/*  smooth line highlight, so the UI extrapolates between updates.      */
/*  Keeping the maths here means it is unit-testable without a DOM.     */
/* ------------------------------------------------------------------ */

/**
 * How far the extrapolated clock may drift from the engine's last reported
 * position before it counts as a real jump (seek, crossfade, buffering, next
 * track). The store ticks every ~220–240 ms and at 2x speed one tick is already
 * ~480 ms of media time — hence the generous window.
 */
export const RESYNC_THRESHOLD_MS = 900;

/** Largest single frame we trust: background tabs throttle rAF to ~1 Hz. */
const MAX_FRAME_MS = 500;

/** One frame of the media clock: `from + elapsed × speed`, clamped to the track end. */
export function advanceMediaClock(fromMs: number, elapsedMs: number, speed: number, durationMs: number): number {
  const step = Math.max(0, Math.min(MAX_FRAME_MS, elapsedMs)) * (speed > 0 ? speed : 1);
  const nextMs = fromMs + step;
  return durationMs > 0 ? Math.min(nextMs, durationMs) : nextMs;
}

/** True when the engine's report disagrees enough with our clock to snap to it. */
export function needsResync(clockMs: number, reportedMs: number, isPlaying: boolean): boolean {
  return !isPlaying || Math.abs(clockMs - reportedMs) > RESYNC_THRESHOLD_MS;
}
