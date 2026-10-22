import type { PlaybackSource } from "./types";

export type HlsPlaybackMode = "direct" | "native-hls" | "mse-hls" | "unsupported";

export interface HlsErrorDataLike {
  type?: string;
  details?: string;
  fatal?: boolean;
  response?: { code?: number };
}

export interface HlsInstanceLike {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, listener: (_event: string, data: HlsErrorDataLike) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
  destroy(): void;
}

export interface HlsConstructorLike {
  new (config?: Record<string, unknown>): HlsInstanceLike;
  isSupported(): boolean;
  Events: {
    ERROR: string;
  };
  ErrorTypes: {
    NETWORK_ERROR: string;
    MEDIA_ERROR: string;
  };
}

export type HlsModuleLoader = () => Promise<{ default: HlsConstructorLike }>;

const defaultHlsLoader: HlsModuleLoader = () =>
  import("hls.js") as unknown as Promise<{ default: HlsConstructorLike }>;

/**
 * Detect genuine native Apple HLS support on an HTMLVideoElement (Safari / iOS WebKit).
 * Never assumes `.m3u8` extension plays on Chromium or Firefox.
 */
export function hasNativeHlsSupport(
  video: Pick<HTMLMediaElement, "canPlayType"> | null | undefined
): boolean {
  if (!video || typeof video.canPlayType !== "function") return false;
  return Boolean(
    video.canPlayType("application/vnd.apple.mpegurl") ||
      video.canPlayType("application/x-mpegURL")
  );
}

/**
 * Determine the exact playback strategy for a candidate stream.
 * Returns `"unsupported"` when an HLS manifest has neither native HLS nor MSE (`hls.js`).
 */
export function resolvePlaybackStrategy(input: {
  streamType: PlaybackSource["type"];
  nativeHls: boolean;
  mseHls: boolean;
}): HlsPlaybackMode {
  if (input.streamType !== "hls") return "direct";
  if (input.nativeHls) return "native-hls";
  if (input.mseHls) return "mse-hls";
  return "unsupported";
}

function formatHlsFatalReason(data: HlsErrorDataLike, ErrorTypes: HlsConstructorLike["ErrorTypes"]): string {
  if (data.type === ErrorTypes.NETWORK_ERROR) {
    const code = data.response?.code;
    if (code) {
      return `HLS manifest/segment request failed (HTTP ${code}${data.details ? ` — ${data.details}` : ""}). Open the direct link in an external player.`;
    }
    return `HLS network error (${data.details || "manifest/segment blocked by cross-origin CORS or expired token"}). Open the stream in VLC / IINA / MPV.`;
  }
  if (data.type === ErrorTypes.MEDIA_ERROR) {
    return `HLS media decode failed (${data.details || "unsupported video/audio codec in stream segments"}). Open the stream in an external player.`;
  }
  return `HLS playback failed (${data.details || "unsupported stream format"}). Open the link in an external player.`;
}

function resetVideoElement(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Ignore jsdom / unmounted element cleanup errors.
  }
}

export interface AttachPlaybackOptions {
  video: HTMLVideoElement;
  source: PlaybackSource;
  onMode?: (mode: HlsPlaybackMode) => void;
  onFatalError: (reason: string) => void;
  loadHlsModule?: HlsModuleLoader;
}

/**
 * Attach a `PlaybackSource` to an `HTMLVideoElement` using:
 *  - direct `<video src>` for `.mp4` / `.webm`,
 *  - native HLS when `canPlayType('application/vnd.apple.mpegurl')` succeeds (Safari/iOS),
 *  - `hls.js` (MediaSource Extensions) fallback on Chrome / Firefox / Edge with bounded recovery,
 *  - immediate non-playable reporting if neither native HLS nor MSE is available.
 */
export async function attachPlaybackSource(
  options: AttachPlaybackOptions
): Promise<{ mode: HlsPlaybackMode; destroy: () => void }> {
  const { video, source, onMode, onFatalError, loadHlsModule = defaultHlsLoader } = options;

  if (source.type !== "hls") {
    video.src = source.url;
    onMode?.("direct");
    return {
      mode: "direct",
      destroy: () => resetVideoElement(video),
    };
  }

  const nativeHls = hasNativeHlsSupport(video);
  if (nativeHls) {
    video.src = source.url;
    onMode?.("native-hls");
    return {
      mode: "native-hls",
      destroy: () => resetVideoElement(video),
    };
  }

  let HlsCtor: HlsConstructorLike | null = null;
  try {
    const mod = await loadHlsModule();
    HlsCtor = mod?.default ?? null;
  } catch {
    HlsCtor = null;
  }

  const mseSupported = Boolean(HlsCtor && HlsCtor.isSupported());
  const mode = resolvePlaybackStrategy({
    streamType: "hls",
    nativeHls: false,
    mseHls: mseSupported,
  });

  if (mode !== "mse-hls" || !HlsCtor) {
    resetVideoElement(video);
    onMode?.("unsupported");
    onFatalError(
      "This browser supports neither native Apple HLS nor MediaSource Extensions (hls.js). Copy or open the stream URL in an external player."
    );
    return {
      mode: "unsupported",
      destroy: () => resetVideoElement(video),
    };
  }

  const Hls = HlsCtor;
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
  });

  let networkRecovered = false;
  let mediaRecovered = false;
  let destroyed = false;

  const cleanup = () => {
    if (destroyed) return;
    destroyed = true;
    try {
      hls.destroy();
    } catch {
      // Ignore duplicate destroy error.
    }
    resetVideoElement(video);
  };

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (destroyed || !data?.fatal) return;

    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRecovered) {
      networkRecovered = true;
      hls.startLoad();
      return;
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
      mediaRecovered = true;
      hls.recoverMediaError();
      return;
    }

    const reason = formatHlsFatalReason(data, Hls.ErrorTypes);
    cleanup();
    onFatalError(reason);
  });

  hls.loadSource(source.url);
  hls.attachMedia(video);
  onMode?.("mse-hls");

  return {
    mode: "mse-hls",
    destroy: cleanup,
  };
}
