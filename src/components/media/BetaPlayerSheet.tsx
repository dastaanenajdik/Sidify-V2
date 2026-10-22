"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { AlertCircle, Download, Loader2, RotateCcw, SkipForward, VolumeX } from "lucide-react";
import { Sheet } from "@/components/ui";
import { probeBrowserCapabilities } from "@/lib/media/browserCaps";
import { mediaApi } from "@/lib/media/client";
import { attachPlaybackSource } from "@/lib/media/hlsPlayer";
import {
  PlaybackSession,
  classifyMediaError,
  playableReleases,
  runPlaybackFallback,
  type AttemptOutcome,
  type PlaybackStatus,
  type StreamCandidate,
} from "@/lib/media/playbackPlan";
import { compatibilityNotes, hintChips, parseReleaseHints } from "@/lib/media/releaseHints";
import type { MediaReleaseItem } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { cx } from "@/lib/format";
import { useMounted } from "@/lib/useMounted";
import { ExternalPlayerLinks } from "./ExternalPlayerLinks";
import type { WatchTarget } from "./watch";

/** How long one link may take to show its first frame before we try the next one. */
const ATTEMPT_TIMEOUT_MS = 15_000;

export function BetaBadge({
  tone = "amber",
  className,
}: {
  /** `amber` on neutral surfaces, `inverse` inside primary buttons, `onWhite` on the white hero button. */
  tone?: "amber" | "inverse" | "onWhite";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "rounded-full px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.06em] uppercase",
        tone === "amber" && "bg-amber-500/15 text-amber-500",
        tone === "inverse" && "bg-on-primary/15 text-on-primary",
        tone === "onWhite" && "bg-black/10 text-black/70",
        className
      )}
    >
      Beta
    </span>
  );
}

interface BetaPlayerHandle {
  stop: () => void;
}

/**
 * "Try Play (beta)": plays a release's resolved direct link in the browser, starting with
 * the highest quality and falling back to lower ones when a link fails. The browser
 * fetches the file straight from the host — nothing is proxied or transcoded by Sidify.
 */
export function BetaPlayerSheet({
  target,
  onClose,
  onDownload,
}: {
  target: WatchTarget | null;
  onClose: () => void;
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

function qualityLabel(release: MediaReleaseItem | undefined): string {
  return release?.quality || "file";
}

function statusText(status: PlaybackStatus | null): string {
  if (!status) return "Getting ready…";
  const q = qualityLabel(status.release);
  switch (status.phase) {
    case "resolving":
      return `Getting the ${q} link…`;
    case "refreshing":
      return `Refreshing the ${q} link…`;
    case "trying":
      return `Starting ${q}${status.candidate ? ` · ${status.candidate.server}` : ""}…`;
    case "playing":
      return `${q}${status.candidate ? ` · ${status.candidate.server}` : ""}`;
    case "failed":
    default:
      return SOMETHING_WENT_WRONG;
  }
}

function BetaPlayer({
  target,
  onDownload,
  ref,
}: {
  target: WatchTarget;
  onDownload: () => void;
  ref?: Ref<BetaPlayerHandle>;
}) {
  const releases = useMemo(() => playableReleases(target.releases), [target.releases]);
  const mounted = useMounted();
  const caps = useMemo(() => (mounted ? probeBrowserCapabilities() : null), [mounted]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<PlaybackSession | null>(null);
  const hlsTeardownRef = useRef<(() => void) | null>(null);
  /** URL whose playback was established — late errors on it trigger recovery. */
  const liveUrlRef = useRef<string | null>(null);
  const activeIndexRef = useRef(0);
  const lateFailureRef = useRef<() => void>(() => {});
  /** Last position reached on an established link — "Try again" resumes from here. */
  const resumeAtRef = useRef<number | undefined>(undefined);

  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("working");
  const [activeIndex, setActiveIndex] = useState(0);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const resetVideo = useCallback(() => {
    const teardown = hlsTeardownRef.current;
    hlsTeardownRef.current = null;
    liveUrlRef.current = null;
    if (teardown) {
      teardown();
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

  /** Load one candidate and wait for real playback events to decide. */
  const attempt = useCallback(
    (candidate: StreamCandidate, startAt: number | undefined, signal: AbortSignal): Promise<AttemptOutcome> => {
      const video = videoRef.current;
      if (!video || signal.aborted) return Promise.resolve({ ok: false, failure: "aborted" });
      resetVideo();

      return new Promise<AttemptOutcome>((resolve) => {
        let settled = false;
        let metadata = false;

        const finish = (result: AttemptOutcome) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          video.removeEventListener("loadedmetadata", onMetadata);
          video.removeEventListener("loadeddata", onData);
          video.removeEventListener("error", onError);
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const onMetadata = () => {
          metadata = true;
          if (startAt && startAt > 1 && (!Number.isFinite(video.duration) || startAt < video.duration - 1)) {
            try {
              video.currentTime = startAt;
            } catch {
              /* seeking not possible yet */
            }
          }
        };
        const onData = () => {
          // First frame available. No picture means the video track wasn't decoded.
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            liveUrlRef.current = candidate.url;
            finish({ ok: true });
            void video.play().catch(() => {
              /* autoplay can be refused — the native controls stay usable */
            });
          } else {
            finish({ ok: false, failure: "no-picture" });
          }
        };
        const onError = () =>
          finish({ ok: false, failure: classifyMediaError(video.error?.code, metadata, video.error?.message) });
        const onAbort = () => finish({ ok: false, failure: "aborted" });
        const timer = window.setTimeout(
          () => finish({ ok: false, failure: metadata && video.videoWidth === 0 ? "no-picture" : "timeout" }),
          ATTEMPT_TIMEOUT_MS
        );

        video.addEventListener("loadedmetadata", onMetadata);
        video.addEventListener("loadeddata", onData);
        video.addEventListener("error", onError);
        signal.addEventListener("abort", onAbort);
        video.preload = "auto";

        if (candidate.kind === "hls") {
          // Existing HLS engine: native HLS (Safari) or hls.js over MSE.
          void attachPlaybackSource({
            video,
            source: { url: candidate.url, type: "hls" },
            onFatalError: () => {
              if (!settled) finish({ ok: false, failure: "network" });
              else if (liveUrlRef.current === candidate.url) lateFailureRef.current();
            },
          }).then((handle) => {
            if (settled && liveUrlRef.current !== candidate.url) handle.destroy();
            else hlsTeardownRef.current = handle.destroy;
          });
        } else {
          video.src = candidate.url;
          video.load();
        }
        void video.play().catch(() => {
          /* loading continues; events decide the outcome */
        });
      });
    },
    [resetVideo]
  );

  /** One fallback run. Only sets state from async callbacks. */
  const run = useCallback(
    async (startIndex: number, startAt?: number, freshSession = true) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (freshSession || !sessionRef.current) sessionRef.current = new PlaybackSession();
      const session = sessionRef.current;
      let current = startIndex;
      const skippedHere = new Set<number>();

      const result = await runPlaybackFallback(session, releases, {
        startIndex,
        signal: controller.signal,
        resolve: (mirror, release, { refresh }) =>
          mediaApi.resolveMirror({
            url: mirror.shortUrl,
            fileName: release.fileName,
            label: release.title,
            refresh,
            signal: controller.signal,
          }),
        attempt: (candidate) => attempt(candidate, startAt, controller.signal),
        onStatus: (next) => {
          if (controller.signal.aborted) return;
          setStatus(next);
          if (typeof next.releaseIndex === "number") {
            if (next.releaseIndex !== current) {
              for (let i = current; i < next.releaseIndex; i++) skippedHere.add(i);
              current = next.releaseIndex;
              setSkipped([...skippedHere]);
            }
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
        for (let i = current; i < releases.length; i++) skippedHere.add(i);
        setSkipped([...skippedHere]);
        resetVideo();
        setOutcome("failed");
      }
    },
    [attempt, releases, resetVideo]
  );

  /** User-initiated restart (quality pick, next quality, try again): a fresh session. */
  const begin = (startIndex: number, startAt?: number) => {
    setOutcome("working");
    setHelpOpen(false);
    setSkipped([]);
    setStatus(null);
    void run(startIndex, startAt, true);
  };

  const stop = useCallback(() => {
    abortRef.current?.abort();
    resetVideo();
  }, [resetVideo]);

  useImperativeHandle(ref, () => ({ stop }), [stop]);

  // Start with the highest quality as soon as the player opens; stop on close. The start is
  // deferred one task so a mount → unmount → mount (React StrictMode) sends one request.
  useEffect(() => {
    const timer = window.setTimeout(() => void run(0), 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
      resetVideo();
    };
  }, [run, resetVideo]);

  // A link that fails after playback started (expired token, dropped connection):
  // automatic recovery in the SAME session, so the one re-resolve is never exceeded.
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
      if (liveUrlRef.current) lateFailureRef.current();
    };
    const onTime = () => {
      if (liveUrlRef.current && Number.isFinite(video.currentTime) && video.currentTime > 1) {
        resumeAtRef.current = video.currentTime;
      }
    };
    video.addEventListener("error", onLateError);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.removeEventListener("error", onLateError);
      video.removeEventListener("timeupdate", onTime);
    };
  }, []);

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

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-edge">
        <video
          ref={videoRef}
          // Native controls only once a link plays; while trying / after failing the overlay speaks.
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
                <span className="text-[13.5px] font-semibold">{statusText(status)}</span>
                {skipped.length > 0 && (
                  <span className="text-[12px] text-white/70">
                    {skipped.map((i) => labels[i]).filter(Boolean).join(", ")} didn&apos;t play here — trying a lower quality
                  </span>
                )}
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
        {outcome === "failed" ? SOMETHING_WENT_WRONG : statusText(status)}
      </p>

      {outcome === "failed" ? (
        <div className="mt-3 rounded-[12px] bg-fill px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => begin(0, resumeAtRef.current)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90"
            >
              <RotateCcw size={13} aria-hidden="true" /> Try again
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
            >
              <Download size={13} aria-hidden="true" /> Download instead
            </button>
          </div>
          {lastUrl && (
            <div className="mt-3">
              <p className="mb-1.5 text-[12.5px] font-semibold text-fg-2">Or open it in a player app</p>
              <ExternalPlayerLinks url={lastUrl} title={target.mediaTitle} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12.5px] font-semibold text-fg-2">
              {outcome === "playing" ? statusText(status) : "Quality"}
            </span>
            {releases.map((release, index) => (
              <button
                key={release.id}
                type="button"
                aria-pressed={index === activeIndex}
                onClick={() => begin(index, currentTime())}
                className={cx(
                  "h-7 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors",
                  index === activeIndex ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2",
                  skipped.includes(index) && index !== activeIndex && "text-fg-3 line-through"
                )}
              >
                {chipLabel(release, index)}
              </button>
            ))}
          </div>

          {(chips.length > 0 || notes.length > 0) && (
            <div className="mt-2 space-y-1">
              {chips.length > 0 && (
                <p className="text-[12px] text-fg-2">
                  From the file name (not verified): <span className="font-semibold text-fg">{chips.join(" · ")}</span>
                </p>
              )}
              {notes.map((note) => (
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
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
            >
              <VolumeX size={13} aria-hidden="true" /> No sound / black screen?
            </button>
          </div>

          {helpOpen && (
            <div className="mt-2.5 rounded-[12px] bg-fill px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-fg-2">
                Your browser may not support this file&apos;s audio or video format. Try another quality, or open the
                same link in a player app — it streams without downloading.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {hasNext && (
                  <button
                    type="button"
                    onClick={() => begin(activeIndex + 1, currentTime())}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90"
                  >
                    <SkipForward size={13} aria-hidden="true" /> Try {qualityLabel(releases[activeIndex + 1])}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDownload}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
                >
                  <Download size={13} aria-hidden="true" /> Download instead
                </button>
              </div>
              {lastUrl && <ExternalPlayerLinks url={lastUrl} title={target.mediaTitle} className="mt-3" />}
            </div>
          )}
        </>
      )}

      <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">
        Beta: starts with the highest quality and steps down if a link won&apos;t play. Your browser streams the file
        directly from the host.
      </p>
    </div>
  );
}
