"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { AlertCircle, Download, Loader2, RotateCcw, RotateCw, SkipForward, VolumeX } from "lucide-react";
import { MediaApiError, mediaApi } from "@/lib/media/client";
import { redactUrl, reportMediaDiagnostic } from "@/lib/media/diagnostics";
import {
  buildJwPlaylistItem,
  classifyJwError,
  getJwLibraryUrl,
  isJwPlayableCandidate,
  loadJwPlayerLibrary,
  type JwPlayerInstance,
} from "@/lib/media/jwPlayer";
import {
  PlaybackSession,
  audioVerdict,
  playableReleases,
  runPlaybackFallback,
  type AttemptOutcome,
  type PlaybackStatus,
  type SilentCandidate,
  type StreamCandidate,
} from "@/lib/media/playbackPlan";
import {
  clearResumePoint,
  formatPlaybackTime,
  loadResumePoint,
  resumePosition,
  saveResumePoint,
} from "@/lib/media/resumePoints";
import type { MediaReleaseItem } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { cx } from "@/lib/format";
import { ExternalPlayerLinks } from "./ExternalPlayerLinks";
import { TelegramDownloadButton } from "./TelegramDownloadButton";
import { VlcPlayButton } from "./VlcPlayButton";
import type { WatchTarget } from "./watch";

export interface JwTryPlayHandle {
  stop: () => void;
}

/** How long one link may take to show its first frame before trying the next one. */
const ATTEMPT_TIMEOUT_MS = 25_000;
const SEEK_STEP_SECONDS = 10;
const SAVE_EVERY_SECONDS = 5;

type Outcome = "working" | "playing" | "failed";
type ReleaseFailure = "no-audio" | "failed";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3";
const primaryChip =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90";

function qualityLabel(release: MediaReleaseItem | undefined): string {
  return release?.quality || "file";
}

function statusText(status: PlaybackStatus | null): string {
  if (!status) return "Getting ready…";
  const q = qualityLabel(status.release);
  const server = status.candidate ? ` · ${status.candidate.server}` : "";
  switch (status.phase) {
    case "resolving":
      return `Getting the ${q} link…`;
    case "refreshing":
      return `Refreshing the ${q} link…`;
    case "trying":
      return `Starting ${q}${server}…`;
    case "playing":
      return `${q}${server}`;
    default:
      return SOMETHING_WENT_WRONG;
  }
}

type DecoderCounters = HTMLVideoElement & {
  webkitAudioDecodedByteCount?: number;
  webkitVideoDecodedByteCount?: number;
};

/**
 * The JW Player route of "Try Play": the same resolved links and the same
 * quality-fallback loop as the built-in player, but every candidate is
 * handed to the operator's JW Player (`setup()` with a one-item playlist in
 * JW format), so HLS audio renditions and captions come from JW's own
 * control bar. Sound is still verified before a link is accepted — JW's
 * audio-track list first, the inner `<video>`'s decoder counters as proof —
 * so a silent encode steps down to the next quality exactly as before.
 * Containers JW cannot open (MKV etc.) fail as decode errors and land the
 * viewer on the usual VLC / Download hand-off instead of a frozen player.
 */
export function JwTryPlayPlayer({
  target,
  onOpenVlc,
  onDownload,
  ref,
}: {
  target: WatchTarget;
  onOpenVlc?: () => void;
  onDownload: () => void;
  ref?: Ref<JwTryPlayHandle>;
}) {
  const releases = useMemo(() => playableReleases(target.releases), [target.releases]);
  const resumeKey = target.key;
  const [storedStart] = useState<number | null>(() => resumePosition(loadResumePoint(resumeKey)));

  const holderRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const mountIdRef = useRef(`sidify-jw-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`);
  const playerRef = useRef<JwPlayerInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const liveUrlRef = useRef<string | null>(null);
  const activeIndexRef = useRef(0);
  const resumeAtRef = useRef<number | undefined>(storedStart ?? undefined);
  const requireAudioRef = useRef(true);
  const lastFailureRef = useRef<Record<number, ReleaseFailure>>({});
  const lastSavedRef = useRef(0);

  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("working");
  const [activeIndex, setActiveIndex] = useState(0);
  const [failures, setFailures] = useState<Record<number, ReleaseFailure>>({});
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [silent, setSilent] = useState<SilentCandidate | null>(null);
  const [withoutSound, setWithoutSound] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(storedStart);
  const [libraryMissing, setLibraryMissing] = useState(false);

  /* ---------------------------- player lifecycle --------------------------- */

  const destroyPlayer = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = null;
    liveUrlRef.current = null;
    if (player) {
      try {
        player.remove();
      } catch {
        /* player already gone */
      }
    }
  }, []);

  /** JW replaces its mount element; re-create it inside the holder when needed. */
  const ensureMount = useCallback((): string | null => {
    const holder = holderRef.current;
    if (!holder) return null;
    const id = mountIdRef.current;
    if (!holder.querySelector(`#${CSS.escape(id)}`)) {
      const div = document.createElement("div");
      div.id = id;
      holder.appendChild(div);
    }
    return id;
  }, []);

  const persistPosition = useCallback(() => {
    const player = playerRef.current;
    if (!player || !liveUrlRef.current) return;
    const position = player.getPosition();
    if (!Number.isFinite(position)) return;
    lastSavedRef.current = position;
    const duration = player.getDuration();
    saveResumePoint(resumeKey, position, Number.isFinite(duration) ? duration : undefined);
  }, [resumeKey]);

  /* --------------------------------- attempt -------------------------------- */

  const attempt = useCallback(
    (candidate: StreamCandidate, release: MediaReleaseItem, startAt: number | undefined, signal: AbortSignal): Promise<AttemptOutcome> => {
      if (signal.aborted) return Promise.resolve({ ok: false, failure: "aborted" });
      destroyPlayer();

      const quality = qualityLabel(release);
      const releaseIndex = releases.indexOf(release);
      const jwCandidate = {
        url: candidate.url,
        streamType: candidate.streamType,
        container: candidate.container ?? release.container,
        fileName: release.fileName ?? release.title,
        kind: candidate.kind,
      };

      // JW cannot open MKV/AVI/archive encodes at all — fail at file level so
      // the loop steps to the next quality instead of spinning in JW's UI.
      if (!isJwPlayableCandidate(jwCandidate)) {
        if (releaseIndex >= 0) lastFailureRef.current[releaseIndex] = "failed";
        reportMediaDiagnostic("Try Play (JW): container JW cannot open", {
          quality,
          container: candidate.container ?? release.container,
          file: redactUrl(candidate.url),
        });
        return Promise.resolve({ ok: false, failure: "decode" });
      }

      const playlistItem = buildJwPlaylistItem({
        candidate: jwCandidate,
        title: target.mediaTitle,
        poster: target.poster,
        qualityLabel: quality,
      });
      if (!playlistItem) return Promise.resolve({ ok: false, failure: "decode" });

      return new Promise<AttemptOutcome>((resolve) => {
        let settled = false;
        let player: JwPlayerInstance | null = null;
        let audioTimer: number | undefined;

        const finish = (result: AttemptOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          window.clearTimeout(audioTimer);
          signal.removeEventListener("abort", onAbort);
          if (!result.ok) {
            if (releaseIndex >= 0 && result.failure !== "aborted") {
              lastFailureRef.current[releaseIndex] = result.failure === "no-audio" ? "no-audio" : "failed";
            }
            if (player && playerRef.current === player) playerRef.current = null;
            try {
              player?.remove();
            } catch {
              /* already gone */
            }
          }
          resolve(result);
        };

        const onAbort = () => finish({ ok: false, failure: "aborted" });
        const timer = window.setTimeout(() => finish({ ok: false, failure: "timeout" }), ATTEMPT_TIMEOUT_MS);
        signal.addEventListener("abort", onAbort);

        /** Accept only once sound is really decoding (or the viewer allowed silence). */
        const verifyAudioAndAccept = () => {
          if (settled || !player) return;
          if (!requireAudioRef.current) {
            liveUrlRef.current = candidate.url;
            finish({ ok: true });
            return;
          }
          const innerVideo = () =>
            (holderRef.current?.querySelector("video") as DecoderCounters | null) ??
            (player?.getContainer?.()?.querySelector("video") as DecoderCounters | null) ??
            null;
          const fromPosition = player.getPosition() || 0;
          const deadline = Date.now() + 9_000;

          const tick = () => {
            if (settled || !player) return;
            const video = innerVideo();
            const jwHasAudioTrack = (() => {
              try {
                return (player.getAudioTracks?.()?.length ?? 0) > 0;
              } catch {
                return false;
              }
            })();
            const verdict = audioVerdict({
              progress: Math.max(0, (player.getPosition() || 0) - fromPosition),
              audioBytes: video?.webkitAudioDecodedByteCount,
              videoBytes: video?.webkitVideoDecodedByteCount,
              frames: video?.getVideoPlaybackQuality?.().totalVideoFrames,
            });
            if (verdict === "audio" || (verdict === "unknown" && jwHasAudioTrack)) {
              liveUrlRef.current = candidate.url;
              finish({ ok: true });
            } else if (verdict === "silent" && !jwHasAudioTrack) {
              finish({ ok: false, failure: "no-audio" });
            } else if (Date.now() > deadline) {
              // Counters unavailable and JW lists no separate audio track —
              // accept rather than reject a playing link on no evidence.
              liveUrlRef.current = candidate.url;
              finish({ ok: true });
            } else {
              audioTimer = window.setTimeout(tick, 300);
            }
          };
          tick();
        };

        void loadJwPlayerLibrary(getJwLibraryUrl())
          .then((jwplayer) => {
            if (settled) return;
            const id = ensureMount();
            if (!id) {
              finish({ ok: false, failure: "decode" });
              return;
            }
            player = jwplayer(id);
            playerRef.current = player;

            player.on("ready", () => {
              if (settled || !player) return;
              try {
                if (startAt && startAt > 1) player.seek(startAt);
                player.play();
              } catch {
                /* JW controls remain usable */
              }
            });
            player.on("firstFrame", verifyAudioAndAccept);
            player.on("error", (event) => {
              const message = typeof event?.message === "string" ? event.message : undefined;
              reportMediaDiagnostic("Try Play (JW): player error", {
                quality,
                server: candidate.server,
                message,
                file: redactUrl(candidate.url),
              });
              finish({ ok: false, failure: classifyJwError(message) });
            });
            player.on("setupError", (event) => {
              const message = typeof event?.message === "string" ? event.message : undefined;
              finish({ ok: false, failure: classifyJwError(message) });
            });
            player.on("time", (event) => {
              if (!liveUrlRef.current || liveUrlRef.current !== candidate.url) return;
              const position = typeof event?.position === "number" ? event.position : NaN;
              if (!Number.isFinite(position)) return;
              if (position > 1) resumeAtRef.current = position;
              if (Math.abs(position - lastSavedRef.current) >= SAVE_EVERY_SECONDS) persistPosition();
            });
            player.on("complete", () => {
              clearResumePoint(resumeKey);
              resumeAtRef.current = undefined;
              lastSavedRef.current = 0;
            });

            player.setup({
              width: "100%",
              aspectratio: "16:9",
              autostart: false,
              controls: true,
              primary: "html5",
              stretching: "uniform",
              playbackRateControls: true,
              preload: "auto",
              playlist: [playlistItem],
            });
          })
          .catch(() => {
            setLibraryMissing(true);
            finish({ ok: false, failure: "network" });
          });
      });
    },
    [destroyPlayer, ensureMount, persistPosition, releases, resumeKey, target.mediaTitle, target.poster]
  );

  /* ----------------------------------- run ---------------------------------- */

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
        signal: controller.signal,
        resolve: async (mirror, release, { refresh }) => {
          try {
            return await mediaApi.resolveMirror({
              url: mirror.shortUrl,
              fileName: release.fileName,
              label: release.title,
              source: mirror.source,
              headers: mirror.headers,
              refresh,
              signal: controller.signal,
            });
          } catch (err) {
            if (!controller.signal.aborted) {
              reportMediaDiagnostic("Try Play (JW): mirror resolve failed", {
                stage: "resolve-api",
                quality: release.quality,
                mirror: redactUrl(mirror.shortUrl),
                httpStatus: err instanceof MediaApiError ? err.status : undefined,
                code: err instanceof MediaApiError ? err.code : (err as Error)?.name,
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
        destroyPlayer();
        setOutcome("failed");
      }
    },
    [attempt, destroyPlayer, releases]
  );

  const begin = (startIndex: number, startAt?: number, options: { pin?: boolean; withoutSound?: boolean } = {}) => {
    persistPosition();
    requireAudioRef.current = !options.withoutSound;
    setWithoutSound(Boolean(options.withoutSound));
    setOutcome("working");
    setFailures({});
    setSilent(null);
    setStatus(null);
    void run(startIndex, startAt, true, Boolean(options.pin));
  };

  const stop = useCallback(() => {
    persistPosition();
    abortRef.current?.abort();
    destroyPlayer();
  }, [destroyPlayer, persistPosition]);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  useEffect(() => {
    const timer = window.setTimeout(() => void run(0, resumeAtRef.current), 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
      destroyPlayer();
    };
  }, [destroyPlayer, run]);

  const seekBy = (delta: number) => {
    const player = playerRef.current;
    if (!player || !liveUrlRef.current) return;
    const position = player.getPosition();
    const duration = player.getDuration();
    if (!Number.isFinite(position)) return;
    const end = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.25) : Number.POSITIVE_INFINITY;
    player.seek(Math.min(end, Math.max(0, position + delta)));
  };

  const startOver = () => {
    clearResumePoint(resumeKey);
    resumeAtRef.current = undefined;
    lastSavedRef.current = 0;
    setResumedFrom(null);
    if (playerRef.current && liveUrlRef.current) playerRef.current.seek(0);
  };

  const currentTime = () => {
    const position = playerRef.current?.getPosition();
    return outcome === "playing" && typeof position === "number" && Number.isFinite(position) ? position : undefined;
  };

  /* ---------------------------------- render --------------------------------- */

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
  const silentQuality = silent ? qualityLabel(silent.release) : null;
  const handoffUrl = silent?.candidate.sourceUrl ?? lastUrl;
  const hasNext = activeIndex + 1 < releases.length;

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-edge">
        <div ref={holderRef} className="h-full w-full bg-black" />
        {outcome !== "playing" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/60 px-6 text-center text-white" aria-hidden="true">
            {outcome === "working" ? (
              <div className="flex flex-col items-center gap-2.5">
                <Loader2 size={26} className="animate-spin text-white/90" />
                <span className="text-[13.5px] font-semibold">{statusText(status)}</span>
                {noSoundLabels.length > 0 && (
                  <span className="max-w-[420px] text-[12px] text-white/70">
                    {noSoundLabels.join(", ")}: no sound here — trying another version
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
        {outcome === "failed" ? (silent ? "No sound in this browser" : SOMETHING_WENT_WRONG) : statusText(status)}
      </p>

      {outcome === "failed" ? (
        <div className="mt-3 rounded-[12px] bg-fill px-3.5 py-3">
          {silent && (
            <div className="mb-3">
              <p className="text-[13.5px] font-semibold text-fg">This video&apos;s sound doesn&apos;t play in your browser</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">
                Its audio format isn&apos;t supported here — JW Player can&apos;t decode it either. VLC plays it with
                sound, and the downloaded file keeps the video and every audio track.
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
            <button type="button" onClick={onDownload} className={chip}>
              <Download size={13} aria-hidden="true" /> Download (video + audio)
            </button>
            <TelegramDownloadButton target={target} className="h-8 px-3.5 text-[12.5px]" iconSize={13} />
            {silent && silentQuality && (
              <button
                type="button"
                onClick={() => begin(silent.releaseIndex, resumeAtRef.current, { pin: true, withoutSound: true })}
                className={chip}
              >
                <VolumeX size={13} aria-hidden="true" /> Play without sound
              </button>
            )}
            <button type="button" onClick={() => begin(0, resumeAtRef.current)} className={chip}>
              <RotateCcw size={13} aria-hidden="true" /> Try again
            </button>
          </div>
          {handoffUrl && (
            <div className="mt-3">
              <p className="mb-1.5 text-[12.5px] font-semibold text-fg-2">Or open it in another player app</p>
              <ExternalPlayerLinks url={handoffUrl} title={target.mediaTitle} />
            </div>
          )}
          {libraryMissing && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-3">
              The JW Player library could not be loaded. Check <code>NEXT_PUBLIC_JWPLAYER_LIBRARY_URL</code> in this
              deployment, or unset it to go back to the built-in player.
            </p>
          )}
        </div>
      ) : (
        <>
          {outcome === "playing" && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => seekBy(-SEEK_STEP_SECONDS)} aria-label="Back 10 seconds" className={chip}>
                <RotateCcw size={14} aria-hidden="true" /> 10s
              </button>
              <button type="button" onClick={() => seekBy(SEEK_STEP_SECONDS)} aria-label="Forward 10 seconds" className={chip}>
                10s <RotateCw size={14} aria-hidden="true" />
              </button>
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
              {hasNext && (
                <button type="button" onClick={() => begin(activeIndex + 1, currentTime(), { pin: true })} className={chip}>
                  <SkipForward size={13} aria-hidden="true" /> Try {qualityLabel(releases[activeIndex + 1])}
                </button>
              )}
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
              Playing without sound — this browser can&apos;t decode the file&apos;s audio. VLC or the downloaded file has it.
            </p>
          )}
        </>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">
        Powered by JW Player: audio language, subtitles and quality are in the player&apos;s own settings (gear icon).
        Starts with the best quality that plays with sound here and steps down if a link won&apos;t play. Remembers
        where you stopped.
      </p>
    </div>
  );
}
