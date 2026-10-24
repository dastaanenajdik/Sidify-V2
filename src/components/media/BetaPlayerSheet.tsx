"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  AlertCircle,
  Captions,
  Download,
  Languages,
  Loader2,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Sheet } from "@/components/ui";
import { MediaApiError, mediaApi } from "@/lib/media/client";
import { redactUrl, reportMediaDiagnostic } from "@/lib/media/diagnostics";
import {
  PlaybackSession,
  audioVerdict,
  classifyMediaError,
  playableReleases,
  runPlaybackFallback,
  streamCandidates,
  type AttemptOutcome,
  type PlaybackStatus,
  type SilentCandidate,
  type StreamCandidate,
} from "@/lib/media/playbackPlan";
import { compatibilityNotes, hintChips, parseReleaseHints, predictSilentAudio } from "@/lib/media/releaseHints";
import {
  clearResumePoint,
  formatPlaybackTime,
  loadResumePoint,
  resumePosition,
  saveResumePoint,
} from "@/lib/media/resumePoints";
import {
  attachShakaPlayback,
  ensureShakaInitialized,
  probeShakaCapabilities,
  type ShakaAudioTrackOption,
  type ShakaErrorEvent,
  type ShakaPlaybackHandle,
  type ShakaTextTrackOption,
} from "@/lib/media/shakaPlayer";
import type { MediaReleaseItem } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { cx } from "@/lib/format";
import { useMounted } from "@/lib/useMounted";
import { BetaBadge } from "./BetaBadge";
import { ExternalPlayerLinks } from "./ExternalPlayerLinks";
import { VlcPlayButton } from "./VlcPlayButton";
import type { WatchTarget } from "./watch";

export { BetaBadge };

/** How long one link may take to parse headers/cues and show its first frame before trying the next one. */
const ATTEMPT_TIMEOUT_MS = 25_000;

interface BetaPlayerHandle {
  stop: () => void;
}

/**
 * "Try Play (beta)": plays a release's resolved direct link in the browser via Shaka Player,
 * starting with the highest quality and handling complex containers & audio codecs
 * (MKV, HLS, DASH, DDP 5.1 / E-AC-3, AC-3, multi-audio tracks).
 */
export function BetaPlayerSheet({
  target,
  onClose,
  onOpenVlc,
  onDownload,
}: {
  target: WatchTarget | null;
  onClose: () => void;
  onOpenVlc?: (target: WatchTarget) => void;
  onDownload: (target: WatchTarget) => void;
}) {
  const playerRef = useRef<BetaPlayerHandle | null>(null);
  const close = useCallback(() => {
    playerRef.current?.stop();
    onClose();
  }, [onClose]);

  return (
    <Sheet
      open={Boolean(target)}
      onClose={close}
      title={target?.heading}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          Try Play <BetaBadge />
        </span>
      }
      width={960}
    >
      {target && (
        <BetaPlayer
          key={target.key}
          ref={playerRef}
          target={target}
          onOpenVlc={
            onOpenVlc
              ? () => {
                  close();
                  onOpenVlc(target);
                }
              : undefined
          }
          onDownload={() => {
            close();
            onDownload(target);
          }}
        />
      )}
    </Sheet>
  );
}

type Outcome = "working" | "playing" | "failed";
/** Why a quality was skipped in this session. */
type ReleaseFailure = "no-audio" | "failed";

/** Seconds per tap of the ⟲ / ⟳ buttons and per ← / → key press. */
const SEEK_STEP_SECONDS = 10;
/** A playing progressive file whose sound can't be confirmed within this window is accepted. */
const AUDIO_CHECK_DEADLINE_MS = 10_000;
/** Save the position every this many seconds of playback (plus on pause / close / hide). */
const SAVE_EVERY_SECONDS = 5;

type DecoderCounters = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
  webkitVideoDecodedByteCount?: number;
};

function qualityLabel(release: MediaReleaseItem | undefined): string {
  return release?.quality || "file";
}

function statusText(status: PlaybackStatus | null, checkingAudio = false): string {
  if (!status) return "Getting ready…";
  const q = qualityLabel(status.release);
  const server = status.candidate ? ` · ${status.candidate.server}` : "";
  switch (status.phase) {
    case "resolving":
      return `Getting the ${q} link…`;
    case "refreshing":
      return `Refreshing the ${q} link…`;
    case "trying":
      return checkingAudio ? `Checking sound · ${q}…` : `Starting ${q}${server}…`;
    case "playing":
      return `${q}${server}`;
    case "failed":
    default:
      return SOMETHING_WENT_WRONG;
  }
}

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3";
const primaryChip =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90";

/** The original file: video + every audio track, whatever the browser can decode. */
function DownloadFileLink({ url, quality }: { url: string; quality: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" download className={chip}>
      <Download size={13} aria-hidden="true" /> Download {quality === "file" ? "file" : quality} (video + audio)
    </a>
  );
}

function BetaPlayer({
  target,
  onOpenVlc,
  onDownload,
  ref,
}: {
  target: WatchTarget;
  onOpenVlc?: () => void;
  onDownload: () => void;
  ref?: Ref<BetaPlayerHandle>;
}) {
  const releases = useMemo(() => playableReleases(target.releases), [target.releases]);
  const mounted = useMounted();
  const caps = useMemo(() => (mounted ? probeShakaCapabilities() : null), [mounted]);
  /** File names suggesting only audio even Shaka + WASM Dolby cannot decode (e.g. lossless TrueHD/DTS-only) → tried after others. */
  const deferred = useMemo(
    () =>
      new Set(
        caps ? releases.filter((r) => predictSilentAudio(parseReleaseHints(r.fileName, r.title), caps)).map((r) => r.id) : []
      ),
    [releases, caps]
  );
  const resumeKey = target.key;
  /** Where this item was left last time (read once, when the player opens). */
  const [storedStart] = useState<number | null>(() => resumePosition(loadResumePoint(resumeKey)));

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const shakaHandleRef = useRef<ShakaPlaybackHandle | null>(null);
  /** URL whose playback was established — late errors on it trigger recovery. */
  const liveUrlRef = useRef<string | null>(null);
  const activeIndexRef = useRef(0);
  const lateFailureRef = useRef<() => void>(() => {});
  /** Last position reached on an established link — "Try again" resumes from here. */
  const resumeAtRef = useRef<number | undefined>(storedStart ?? undefined);
  /** Off only for "Play without sound". */
  const requireAudioRef = useRef(true);
  const capsRef = useRef(caps);
  const deferredRef = useRef(deferred);
  /** Last failure seen per release index in the current session. */
  const lastFailureRef = useRef<Record<number, ReleaseFailure>>({});
  const lastSavedRef = useRef(0);

  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("working");
  const [activeIndex, setActiveIndex] = useState(0);
  const [failures, setFailures] = useState<Record<number, ReleaseFailure>>({});
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** The browser refused autoplay with sound, so playback started muted (one tap restores it). */
  const [mutedByPolicy, setMutedByPolicy] = useState(false);
  const [checkingAudio, setCheckingAudio] = useState(false);
  /** Best link that showed a picture but no sound — offered as "Play without sound". */
  const [silent, setSilent] = useState<SilentCandidate | null>(null);
  const [withoutSound, setWithoutSound] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(storedStart);
  const [audioTracks, setAudioTracks] = useState<ShakaAudioTrackOption[]>([]);
  const [textTracks, setTextTracks] = useState<ShakaTextTrackOption[]>([]);

  useEffect(() => {
    capsRef.current = caps;
    deferredRef.current = deferred;
  }, [caps, deferred]);

  // Pre-initialize Shaka Player polyfills, transmuxers, and WASM Dolby decoder immediately
  useEffect(() => {
    void ensureShakaInitialized();
  }, []);

  const resetVideo = useCallback(() => {
    const handle = shakaHandleRef.current;
    shakaHandleRef.current = null;
    liveUrlRef.current = null;
    setAudioTracks([]);
    setTextTracks([]);
    if (handle) {
      void handle.destroy();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* element already gone */
    }
  }, []);

  /** Remember the position of the link that is playing (never of one being tried). */
  const persistPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video || !liveUrlRef.current || !Number.isFinite(video.currentTime)) return;
    lastSavedRef.current = video.currentTime;
    saveResumePoint(resumeKey, video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
  }, [resumeKey]);

  /**
   * Dynamically creates and attaches a fresh Shaka Player instance for `videoRef.current`
   * and verifies video + audio playback before accepting the candidate.
   */
  const attempt = useCallback(
    (candidate: StreamCandidate, release: MediaReleaseItem, startAt: number | undefined, signal: AbortSignal): Promise<AttemptOutcome> => {
      const video = videoRef.current as DecoderCounters | null;
      if (!video || signal.aborted) return Promise.resolve({ ok: false, failure: "aborted" });
      resetVideo();
      const quality = qualityLabel(release);
      const releaseIndex = releases.indexOf(release);

      return new Promise<AttemptOutcome>((resolve) => {
        let settled = false;
        let metadata = false;
        let shakaReady = false;
        let upgradingMp4 = false;
        let shakaFatal: ShakaErrorEvent | undefined;
        let audioTimer: number | undefined;
        let localHandle: ShakaPlaybackHandle | null = null;

        const finish = (result: AttemptOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          window.clearTimeout(audioTimer);
          setCheckingAudio(false);
          video.removeEventListener("loadedmetadata", onMetadata);
          video.removeEventListener("loadeddata", onData);
          video.removeEventListener("error", onVideoError);
          signal.removeEventListener("abort", onAbort);
          if (!result.ok) {
            if (localHandle && shakaHandleRef.current === localHandle) {
              shakaHandleRef.current = null;
            }
            if (localHandle) {
              void localHandle.destroy();
              localHandle = null;
            }
          }
          if (!result.ok && result.failure !== "aborted") {
            if (releaseIndex >= 0) lastFailureRef.current[releaseIndex] = result.failure === "no-audio" ? "no-audio" : "failed";
            reportMediaDiagnostic("Try Play: Shaka candidate did not play", {
              failure: result.failure,
              quality,
              server: candidate.server,
              kind: candidate.kind,
              file: redactUrl(candidate.url),
              mediaErrorCode: video.error?.code ?? null,
              mediaErrorMessage: video.error?.message?.replace(/https?:\/\/\S+/g, "<url>").slice(0, 160) || undefined,
              readyState: video.readyState,
              networkState: video.networkState,
              metadataLoaded: metadata,
              audioBytes: result.failure === "no-audio" ? (video.webkitAudioDecodedByteCount ?? null) : undefined,
              videoBytes: result.failure === "no-audio" ? (video.webkitVideoDecodedByteCount ?? null) : undefined,
              shakaErrorKind: shakaFatal?.kind,
              shakaErrorCode: shakaFatal?.code,
              shakaErrorDetail: shakaFatal?.detail,
            });
          }
          resolve(result);
        };

        const startPlayback = () => {
          void video.play().catch((err: unknown) => {
            if ((err as { name?: string } | null)?.name !== "NotAllowedError") return;
            if (signal.aborted || video.muted || (settled && liveUrlRef.current !== candidate.url)) return;
            video.muted = true;
            setMutedByPolicy(true);
            reportMediaDiagnostic("Try Play: autoplay with sound was blocked, playing muted", { quality, server: candidate.server });
            void video.play().catch(() => {
              /* events decide */
            });
          });
        };

        const accept = () => {
          liveUrlRef.current = candidate.url;
          finish({ ok: true });
        };

        /**
         * Verifies audio playback once the first video frame is rendered:
         * - In Shaka MSE mode (MKV, HLS, DASH, MP4-MSE), Shaka's ManifestFilterer and our
         *   Dolby-to-FLAC WASM transmuxer have already validated & bound the audio SourceBuffer,
         *   so we accept immediately whenever Shaka has an active audio track (zero false link-jumping!).
         * - In Shaka `src=` mode (progressive MP4/WebM), if the browser's `<video>` reports silent
         *   audio (e.g. an unlabelled progressive MP4 with DDP 5.1), we upgrade that SAME link
         *   in-place to Shaka MP4-MSE + Dolby WASM decoding before ever falling back!
         */
        const verifyAudioAndAccept = () => {
          if (settled || !localHandle) return;
          if (!requireAudioRef.current) {
            accept();
            return;
          }

          if (localHandle.mode === "shaka-mse") {
            if (localHandle.hasAudioTrack()) {
              accept();
            } else {
              finish({ ok: false, failure: "no-audio" });
            }
            return;
          }

          if (!capsRef.current?.audioCounters) {
            accept();
            return;
          }

          window.clearTimeout(timer);
          setCheckingAudio(true);
          const fromTime = video.currentTime;
          const fromFrames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
          const deadline = Date.now() + AUDIO_CHECK_DEADLINE_MS;

          const tick = () => {
            if (settled || upgradingMp4) return;
            const verdict = audioVerdict({
              progress: video.currentTime - fromTime,
              audioBytes: video.webkitAudioDecodedByteCount,
              videoBytes: video.webkitVideoDecodedByteCount,
              frames: (video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) - fromFrames,
            });
            if (verdict === "silent") {
              if (localHandle && localHandle.mimeType === "video/mp4") {
                upgradingMp4 = true;
                setCheckingAudio(false);
                void localHandle.upgradeProgressiveMp4ToMse(video.currentTime).then((upgraded) => {
                  upgradingMp4 = false;
                  if (settled) return;
                  if (upgraded) {
                    startPlayback();
                    accept();
                  } else {
                    finish({ ok: false, failure: "no-audio" });
                  }
                });
                return;
              }
              finish({ ok: false, failure: "no-audio" });
            } else if (verdict === "audio" || verdict === "unknown" || Date.now() > deadline) {
              accept();
            } else {
              audioTimer = window.setTimeout(tick, 250);
            }
          };
          tick();
        };

        const evaluateVideoFrame = () => {
          if (settled || !shakaReady) return;
          if (video.readyState < 2) return;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            startPlayback();
            verifyAudioAndAccept();
          } else {
            finish({ ok: false, failure: "no-picture" });
          }
        };

        const onMetadata = () => {
          metadata = true;
          if (
            localHandle?.mode === "shaka-src" &&
            startAt &&
            startAt > 1 &&
            (!Number.isFinite(video.duration) || startAt < video.duration - 1)
          ) {
            try {
              video.currentTime = startAt;
            } catch {
              /* seeking not possible yet */
            }
          }
        };

        const onData = () => {
          evaluateVideoFrame();
        };

        const onVideoError = () => {
          if (upgradingMp4) return;
          // In MSE mode, Shaka reports structured errors via onFatalError; only fall back here
          // if the HTMLVideoElement itself entered a terminal error state.
          if (video.error) {
            finish({ ok: false, failure: classifyMediaError(video.error.code, metadata, video.error.message) });
          }
        };

        const onAbort = () => finish({ ok: false, failure: "aborted" });
        const timer = window.setTimeout(
          () => finish({ ok: false, failure: metadata && video.videoWidth === 0 ? "no-picture" : "timeout" }),
          ATTEMPT_TIMEOUT_MS
        );

        video.addEventListener("loadedmetadata", onMetadata);
        video.addEventListener("loadeddata", onData);
        video.addEventListener("error", onVideoError);
        signal.addEventListener("abort", onAbort);
        video.preload = "auto";

        void attachShakaPlayback(video, {
          url: candidate.url,
          streamType: candidate.streamType ?? (candidate.kind === "hls" ? "hls" : undefined),
          container: candidate.container ?? release.container,
          fileName: release.fileName ?? release.title,
          startAt,
          signal,
          onTracksChanged: ({ audio, text }) => {
            if (signal.aborted) return;
            setAudioTracks(audio);
            setTextTracks(text);
          },
          onFatalError: (err) => {
            shakaFatal = err;
            if (!settled) {
              finish({ ok: false, failure: err.kind });
            } else if (liveUrlRef.current === candidate.url) {
              lateFailureRef.current();
            }
          },
        })
          .then((handle) => {
            if (settled) {
              void handle.destroy();
              return;
            }
            if (handle.mode === "unsupported") {
              finish({ ok: false, failure: "decode" });
              return;
            }
            localHandle = handle;
            shakaHandleRef.current = handle;
            shakaReady = true;
            startPlayback();
            if (video.readyState >= 1) onMetadata();
            if (video.readyState >= 2) evaluateVideoFrame();
          })
          .catch((err: unknown) => {
            if (signal.aborted || (err as { name?: string } | null)?.name === "AbortError") {
              finish({ ok: false, failure: "aborted" });
              return;
            }
            const classified = (err as { category?: number; code?: number } | null);
            const isMediaOrManifest =
              classified && (classified.category === 3 || classified.category === 4);
            finish({ ok: false, failure: isMediaOrManifest ? "decode" : "network" });
          });
      });
    },
    [releases, resetVideo]
  );

  /** One fallback run. Only sets state from async callbacks. */
  const run = useCallback(
    async (startIndex: number, startAt?: number, freshSession = true, pinStart = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (freshSession || !sessionRef.current) {
        sessionRef.current = new PlaybackSession();
        lastFailureRef.current = {};
      }
      const session = sessionRef.current;
      let current: number | null = null;
      const commitFailure = (index: number | null) => {
        if (index === null) return;
        const reason = lastFailureRef.current[index] ?? "failed";
        setFailures((prev) => (prev[index] === reason ? prev : { ...prev, [index]: reason }));
      };

      const result = await runPlaybackFallback(session, releases, {
        startIndex,
        pinStart,
        isDeferred: (release) => deferredRef.current.has(release.id),
        signal: controller.signal,
        resolve: async (mirror, release, { refresh }) => {
          try {
            const result = await mediaApi.resolveMirror({
              url: mirror.shortUrl,
              fileName: release.fileName,
              label: release.title,
              source: mirror.source,
              headers: mirror.headers,
              refresh,
              signal: controller.signal,
            });
            if (!streamCandidates(result.links).length) {
              reportMediaDiagnostic("Try Play: mirror gave no links to try", {
                stage: "resolve-result",
                quality: release.quality,
                mirror: redactUrl(mirror.shortUrl),
                status: result.status,
                reason: result.reason,
                links: result.links.length,
                refresh,
              });
            }
            return result;
          } catch (err) {
            if (!controller.signal.aborted) {
              reportMediaDiagnostic("Try Play: mirror resolve failed", {
                stage: "resolve-api",
                quality: release.quality,
                mirror: redactUrl(mirror.shortUrl),
                httpStatus: err instanceof MediaApiError ? err.status : undefined,
                code: err instanceof MediaApiError ? err.code : (err as Error)?.name,
                refresh,
              });
            }
            throw err;
          }
        },
        attempt: (candidate, release) => attempt(candidate, release, startAt, controller.signal),
        onStatus: (next) => {
          if (controller.signal.aborted) return;
          setStatus(next);
          if (typeof next.releaseIndex === "number") {
            if (current !== null && next.releaseIndex !== current) commitFailure(current);
            current = next.releaseIndex;
            activeIndexRef.current = next.releaseIndex;
            setActiveIndex(next.releaseIndex);
          }
          if (next.candidate) setLastUrl(next.candidate.sourceUrl);
        },
      });

      if (controller.signal.aborted) return;
      if (result.status === "playing") {
        activeIndexRef.current = result.releaseIndex;
        setActiveIndex(result.releaseIndex);
        setOutcome("playing");
      } else if (result.status === "failed") {
        commitFailure(current);
        setSilent(result.silent ?? null);
        resetVideo();
        setOutcome("failed");
      }
    },
    [attempt, releases, resetVideo]
  );

  /** User-initiated restart (quality pick, next quality, try again): a fresh session. */
  const begin = (startIndex: number, startAt?: number, options: { pin?: boolean; withoutSound?: boolean } = {}) => {
    persistPosition();
    requireAudioRef.current = !options.withoutSound;
    setWithoutSound(Boolean(options.withoutSound));
    setOutcome("working");
    setHelpOpen(false);
    setFailures({});
    setSilent(null);
    setStatus(null);
    void run(startIndex, startAt, true, Boolean(options.pin));
  };

  const stop = useCallback(() => {
    persistPosition();
    abortRef.current?.abort();
    resetVideo();
  }, [persistPosition, resetVideo]);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  useEffect(() => {
    const timer = window.setTimeout(() => void run(0, resumeAtRef.current), 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
      resetVideo();
    };
  }, [run, resetVideo]);

  useEffect(() => {
    lateFailureRef.current = () => {
      const video = videoRef.current;
      const resumeAt = video && Number.isFinite(video.currentTime) ? video.currentTime : undefined;
      liveUrlRef.current = null;
      setOutcome("working");
      void run(activeIndexRef.current, resumeAt, false);
    };
  }, [run]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLateError = () => {
      if (liveUrlRef.current && video.error) lateFailureRef.current();
    };
    const onTime = () => {
      if (!liveUrlRef.current || !Number.isFinite(video.currentTime)) return;
      if (video.currentTime > 1) resumeAtRef.current = video.currentTime;
      if (Math.abs(video.currentTime - lastSavedRef.current) >= SAVE_EVERY_SECONDS) persistPosition();
    };
    const onPause = () => {
      if (!video.ended) persistPosition();
    };
    const onEnded = () => {
      clearResumePoint(resumeKey);
      resumeAtRef.current = undefined;
      lastSavedRef.current = 0;
    };
    const onVolume = () => {
      if (!video.muted) setMutedByPolicy(false);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") persistPosition();
    };
    video.addEventListener("error", onLateError);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("volumechange", onVolume);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", persistPosition);
    return () => {
      video.removeEventListener("error", onLateError);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("volumechange", onVolume);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", persistPosition);
    };
  }, [persistPosition, resumeKey]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video || !liveUrlRef.current || !Number.isFinite(video.currentTime)) return;
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.25) : Number.POSITIVE_INFINITY;
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + delta));
  }, []);

  useEffect(() => {
    if (outcome !== "playing") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "arrowleft" || key === "j") {
        event.preventDefault();
        seekBy(-SEEK_STEP_SECONDS);
      } else if (key === "arrowright" || key === "l") {
        event.preventDefault();
        seekBy(SEEK_STEP_SECONDS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [outcome, seekBy]);

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setMutedByPolicy(false);
    void video.play().catch(() => {
      /* native controls stay usable */
    });
  };

  const startOver = () => {
    const video = videoRef.current;
    clearResumePoint(resumeKey);
    resumeAtRef.current = undefined;
    lastSavedRef.current = 0;
    setResumedFrom(null);
    if (video && liveUrlRef.current) video.currentTime = 0;
  };

  const currentTime = () => {
    const video = videoRef.current;
    return video && outcome === "playing" && Number.isFinite(video.currentTime) ? video.currentTime : undefined;
  };

  const activeRelease = releases[activeIndex];
  const hints = activeRelease ? parseReleaseHints(activeRelease.fileName, activeRelease.title) : null;
  const chips = hints ? hintChips(hints) : [];
  const notes = hints ? compatibilityNotes(hints, caps) : [];
  const hasNext = activeIndex + 1 < releases.length;

  const labels = releases.map((release) => qualityLabel(release));
  const chipLabel = (release: MediaReleaseItem, index: number) => {
    const base = labels[index] === "file" ? "Other" : labels[index];
    const duplicate = labels.filter((l) => l === labels[index]).length > 1;
    return duplicate && release.size ? `${base} · ${release.size}` : base;
  };
  const failedList = Object.entries(failures)
    .map(([index, reason]) => ({ index: Number(index), reason }))
    .filter(({ index }) => index !== activeIndex || outcome === "failed");
  const noSoundLabels = failedList.filter((f) => f.reason === "no-audio").map((f) => labels[f.index]);
  const brokenLabels = failedList.filter((f) => f.reason === "failed").map((f) => labels[f.index]);
  const silentQuality = silent ? qualityLabel(silent.release) : null;
  const handoffUrl = silent?.candidate.sourceUrl ?? lastUrl;

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-edge">
        <video
          ref={videoRef}
          controls={outcome === "playing"}
          playsInline
          preload="auto"
          poster={target.poster}
          className="h-full w-full bg-black"
        >
          Your browser cannot play this video.
        </video>

        {outcome !== "playing" && (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center bg-black/60 px-6 text-center text-white"
            aria-hidden="true"
          >
            {outcome === "working" ? (
              <div className="flex flex-col items-center gap-2.5">
                <Loader2 size={26} className="animate-spin text-white/90" />
                <span className="text-[13.5px] font-semibold">{statusText(status, checkingAudio)}</span>
                {(noSoundLabels.length > 0 || brokenLabels.length > 0) && (
                  <span className="max-w-[420px] text-[12px] text-white/70">
                    {[
                      noSoundLabels.length ? `${noSoundLabels.join(", ")}: no sound in this browser` : "",
                      brokenLabels.length ? `${brokenLabels.join(", ")}: didn't play here` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}{" "}
                    — trying another version
                  </span>
                )}
              </div>
            ) : silent ? (
              <div className="flex flex-col items-center gap-2">
                <VolumeX size={26} className="text-white/90" />
                <span className="text-[14px] font-semibold">No sound in this browser</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <AlertCircle size={26} className="text-white/90" />
                <span className="text-[14px] font-semibold">{SOMETHING_WENT_WRONG}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {outcome === "failed" ? (silent ? "No sound in this browser" : SOMETHING_WENT_WRONG) : statusText(status, checkingAudio)}
      </p>

      {outcome === "failed" ? (
        <div className="mt-3 rounded-[12px] bg-fill px-3.5 py-3">
          {silent && (
            <div className="mb-3">
              <p className="text-[13.5px] font-semibold text-fg">This video&apos;s sound doesn&apos;t play in your browser</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">
                Its audio format isn&apos;t supported here. VLC plays it with sound, and the downloaded file keeps the
                video and every audio track.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {(target.releases.length > 0 || handoffUrl) && (
              <VlcPlayButton
                url={target.releases.length > 0 ? undefined : handoffUrl}
                releases={target.releases}
                onOpen={onOpenVlc}
                title={target.mediaTitle}
                heading={target.heading}
                className={cx(primaryChip, "active:scale-[0.97]")}
              />
            )}
            {silent && silentQuality ? (
              <>
                <DownloadFileLink url={silent.candidate.sourceUrl} quality={silentQuality} />
                <button
                  type="button"
                  onClick={() => begin(silent.releaseIndex, resumeAtRef.current, { pin: true, withoutSound: true })}
                  className={chip}
                >
                  <VolumeX size={13} aria-hidden="true" /> Play without sound
                </button>
              </>
            ) : (
              <button type="button" onClick={onDownload} className={chip}>
                <Download size={13} aria-hidden="true" /> Download (video + audio)
              </button>
            )}
            <button type="button" onClick={() => begin(0, resumeAtRef.current)} className={chip}>
              <RotateCcw size={13} aria-hidden="true" /> Try again
            </button>
          </div>
          {handoffUrl && (
            <div className="mt-3">
              <p className="mb-1.5 text-[12.5px] font-semibold text-fg-2">
                {silent ? "Play with sound in VLC" : "Or open it in another player app"}
              </p>
              <ExternalPlayerLinks url={handoffUrl} title={target.mediaTitle} />
            </div>
          )}
        </div>
      ) : (
        <>
          {outcome === "playing" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => seekBy(-SEEK_STEP_SECONDS)}
                aria-label="Back 10 seconds"
                title="Back 10 seconds (←)"
                className={chip}
              >
                <RotateCcw size={14} aria-hidden="true" /> 10s
              </button>
              <button
                type="button"
                onClick={() => seekBy(SEEK_STEP_SECONDS)}
                aria-label="Forward 10 seconds"
                title="Forward 10 seconds (→)"
                className={chip}
              >
                10s <RotateCw size={14} aria-hidden="true" />
              </button>
              {mutedByPolicy && (
                <button type="button" onClick={unmute} className={primaryChip}>
                  <Volume2 size={13} aria-hidden="true" /> Turn sound on
                </button>
              )}
              {resumedFrom !== null && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill/60 pr-1 pl-3 text-[12.5px] text-fg-2">
                  Resumed from {formatPlaybackTime(resumedFrom)}
                  <button
                    type="button"
                    onClick={startOver}
                    className="h-6 rounded-full bg-fill-2 px-2.5 text-[12px] font-semibold text-fg hover:bg-fill-3"
                  >
                    Start over
                  </button>
                </span>
              )}
            </div>
          )}

          {outcome === "playing" && audioTracks.length > 1 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-fg-2">
                <Languages size={13} aria-hidden="true" /> Audio
              </span>
              {audioTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  aria-pressed={track.active}
                  onClick={() => shakaHandleRef.current?.selectAudioTrack(track.id)}
                  className={cx(
                    "h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
                    track.active ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
                  )}
                >
                  {track.label}
                </button>
              ))}
            </div>
          )}

          {outcome === "playing" && textTracks.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-fg-2">
                <Captions size={13} aria-hidden="true" /> Subtitles
              </span>
              <button
                type="button"
                aria-pressed={textTracks.every((t) => !t.active)}
                onClick={() => void shakaHandleRef.current?.selectTextTrack(null)}
                className={cx(
                  "h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
                  textTracks.every((t) => !t.active) ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
                )}
              >
                Off
              </button>
              {textTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  aria-pressed={track.active}
                  onClick={() => void shakaHandleRef.current?.selectTextTrack(track.id)}
                  className={cx(
                    "h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
                    track.active ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
                  )}
                >
                  {track.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12.5px] font-semibold text-fg-2">
              {outcome === "playing" ? statusText(status) : "Quality"}
            </span>
            {releases.map((release, index) => (
              <button
                key={release.id}
                type="button"
                aria-pressed={index === activeIndex}
                onClick={() => begin(index, currentTime(), { pin: true })}
                title={failures[index] === "no-audio" ? "No sound in this browser" : undefined}
                className={cx(
                  "h-7 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors",
                  index === activeIndex ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2",
                  failures[index] && index !== activeIndex && "text-fg-3 line-through"
                )}
              >
                {chipLabel(release, index)}
              </button>
            ))}
          </div>

          {outcome === "playing" && withoutSound && (
            <p className="mt-2 text-[12px] text-fg-2">
              Playing without sound — this browser can&apos;t decode the file&apos;s audio. VLC or the downloaded file
              has it.
            </p>
          )}

          {(chips.length > 0 || notes.length > 0) && (
            <div className="mt-2 space-y-1">
              {chips.length > 0 && (
                <p className="text-[12px] text-fg-2">
                  From the file name (not verified): <span className="font-semibold text-fg">{chips.join(" · ")}</span>
                </p>
              )}
              {!caps?.audioCounters &&
                notes.map((note) => (
                  <p key={note} className="text-[11.5px] leading-relaxed text-fg-3">
                    {note}
                  </p>
                ))}
            </div>
          )}

          <div className="mt-3">
            <button
              type="button"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((open) => !open)}
              className={chip}
            >
              <VolumeX size={13} aria-hidden="true" /> No sound / black screen?
            </button>
          </div>

          {helpOpen && (
            <div className="mt-2.5 rounded-[12px] bg-fill px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-fg-2">
                Your browser may not support this file&apos;s audio or video format. Try another quality, or open the
                same link in VLC — it streams with sound. The downloaded file always has video + audio.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {hasNext && (
                  <button
                    type="button"
                    onClick={() => begin(activeIndex + 1, currentTime(), { pin: true })}
                    className={primaryChip}
                  >
                    <SkipForward size={13} aria-hidden="true" /> Try {qualityLabel(releases[activeIndex + 1])}
                  </button>
                )}
                {(target.releases.length > 0 || lastUrl) && (
                  <VlcPlayButton
                    url={target.releases.length > 0 ? undefined : lastUrl}
                    releases={target.releases}
                    onOpen={onOpenVlc}
                    title={target.mediaTitle}
                    heading={target.heading}
                    className={cx(chip, "active:scale-[0.97]")}
                  />
                )}
                {lastUrl ? (
                  <DownloadFileLink url={lastUrl} quality={qualityLabel(activeRelease)} />
                ) : (
                  <button type="button" onClick={onDownload} className={chip}>
                    <Download size={13} aria-hidden="true" /> Download (video + audio)
                  </button>
                )}
              </div>
              {lastUrl && <ExternalPlayerLinks url={lastUrl} title={target.mediaTitle} className="mt-3" />}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">
        Powered by Shaka Player: starts with the best quality that plays with sound here and steps down if a link
        won&apos;t play. Remembers where you stopped. Your browser streams the file directly from the host.
      </p>
    </div>
  );
}
