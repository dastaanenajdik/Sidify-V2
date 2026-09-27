/** Framework-free playback policy. A video preference is not a background engine. */
type Engine = "native" | "iframe" | null;
export type EngineAction = "none" | "play-native" | "play-video" | "resume-video";

export function decideEngineAction({
  playing, loading, engine, videoMode, playerOpen, appVisible, hasVideo, iframePaused, videoBlocked,
}: {
  playing: boolean;
  loading: boolean;
  engine: Engine;
  videoMode: boolean;
  playerOpen: boolean;
  appVisible: boolean;
  hasVideo: boolean;
  iframePaused: boolean;
  videoBlocked: boolean;
}): EngineAction {
  if (!playing || loading || engine === null) return "none";
  const wantVideo = videoMode && !videoBlocked && playerOpen && appVisible && hasVideo;
  if (wantVideo) {
    if (engine !== "iframe") return "play-video";
    return iframePaused ? "resume-video" : "none";
  }
  return engine === "iframe" ? "play-native" : "none";
}

/**
 * Should native playback move to a plain `<audio>` element that is *not* wired into the
 * Web Audio graph?
 *
 * A media element whose output goes through `createMediaElementSource` stops counting as
 * "audible" for the browser's tab-audio bookkeeping, and mobile browsers (Android Chrome
 * in particular) then stop rendering it once the page is hidden / the screen is locked —
 * often without the AudioContext ever reporting `suspended`, so no state event fires.
 * That is the "music pauses on screen-off even though the app is alive" report.
 *
 * So on mobile we hand off *proactively* the moment the app goes off-screen (the switch
 * has to happen while we still have CPU — a frozen background tab cannot run the
 * recovery later). Desktop keeps the graph unless it genuinely stalls, so switching
 * windows does not cost the EQ and a re-buffer.
 */
export function needsPlainElement({ hidden, playing, engine, ctxRunning, mobile }: {
  hidden: boolean;
  playing: boolean;
  engine: Engine;
  ctxRunning: boolean;
  mobile: boolean;
}): boolean {
  if (!hidden || !playing || engine !== "native") return false;
  return mobile || !ctxRunning;
}

export type HiddenPauseRecovery = "none" | "plain-handoff" | "plain-resume" | "iframe-resume";

/**
 * A pause we never asked for, while the page is hidden, is a browser/OS decision, not a
 * user action — try to get the audio back. `attempts` is per hidden window so a
 * permanently blocked element cannot spin in a resume loop.
 */
export function decideHiddenPauseRecovery({ hidden, wantedPlaying, engine, plainActive, plainPaused, attempts, maxAttempts = 2 }: {
  hidden: boolean;
  wantedPlaying: boolean;
  engine: Engine;
  plainActive: boolean;
  plainPaused: boolean;
  attempts: number;
  maxAttempts?: number;
}): HiddenPauseRecovery {
  if (!hidden || !wantedPlaying || attempts >= maxAttempts) return "none";
  if (engine === "iframe") return "iframe-resume";
  if (plainActive) return plainPaused ? "plain-resume" : "none";
  return "plain-handoff";
}
