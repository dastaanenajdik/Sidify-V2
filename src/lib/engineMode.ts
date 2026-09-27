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

export function needsPlainElement({ hidden, playing, engine, ctxRunning }: {
  hidden: boolean;
  playing: boolean;
  engine: Engine;
  ctxRunning: boolean;
}): boolean {
  return hidden && playing && engine === "native" && !ctxRunning;
}
