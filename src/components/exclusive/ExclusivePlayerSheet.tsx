"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Captions,
  ChevronDown,
  ExternalLink,
  Gauge,
  Languages,
  Loader2,
  RotateCcw,
  Volume2,
  X,
} from "lucide-react";
import { useExclusiveTitle } from "@/lib/media/hooks";
import {
  attachShakaPlayback,
  type ShakaAudioTrackOption,
  type ShakaPlaybackHandle,
  type ShakaTextTrackOption,
  type ShakaVideoQualityOption,
} from "@/lib/media/shakaPlayer";
import {
  audioDiagnosis,
  audioHealthVerdict,
  describeAudioTrack,
  nextAudioRecovery,
  type AudioHealth,
} from "@/lib/media/audioHealth";
import { formatPlaybackTime, loadResumePoint, resumePosition, saveResumePoint } from "@/lib/media/resumePoints";
import type { MediaKind, MediaTitle, PlaybackSource } from "@/lib/media/types";
import { Button } from "@/components/ui";
import { mediaHref } from "@/components/media/PosterCard";
import { ExclusiveBadge } from "@/components/media/ExclusiveBadge";
import { cx } from "@/lib/format";

/** How often the audio watchdog samples decoder counters. */
const AUDIO_SAMPLE_MS = 1_000;
/** How often a playback position is written to localStorage. */
const RESUME_SAVE_MS = 5_000;

type PlayerStatus = "loading" | "ready" | "error" | "empty";

/**
 * The exclusive collection's own player.
 *
 * Shaka Player is the engine for every source this sheet is given: DASH
 * manifests relayed by the app, HLS, and progressive MP4/WebM. On top of the
 * engine it adds the four controls a film catalogue needs:
 *
 *   - **Quality** — the manifest's own height ladder, or "Auto" (ABR).
 *   - **Audio** — every audio adaptation set, selectable. This is the fix for
 *     "the picture plays but there is no sound": the default track is often a
 *     surround codec the browser cannot decode, while a stereo AAC track sits
 *     right beside it.
 *   - **Subtitles** — the manifest's text tracks, on/off.
 *   - **Audio watchdog** — compares decoded audio bytes with rendered video
 *     frames; a silent stream switches track, then reloads, then explains.
 *
 * Positions are shared with the title page's own player (same resume key), so
 * starting here and finishing there continues where the viewer stopped.
 */
export function ExclusivePlayerSheet({
  slug,
  kind,
  fallbackTitle,
  onClose,
}: {
  slug: string;
  kind?: MediaKind;
  fallbackTitle?: string;
  onClose: () => void;
}) {
  const query = useExclusiveTitle(slug, kind);
  const detail = query.data?.detail;
  const title = detail?.title;

  const sources = useMemo<PlaybackSource[]>(() => {
    const list = detail?.playback ?? [];
    // DASH first (adaptive, one source for every quality), then HLS, then files.
    const rank = (source: PlaybackSource) => (source.type === "dash" ? 0 : source.type === "hls" ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, [detail?.playback]);

  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[Math.min(sourceIndex, Math.max(0, sources.length - 1))] ?? null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<ShakaPlaybackHandle | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const startAtRef = useRef<number | null>(null);
  const lastSaveRef = useRef(0);

  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audio, setAudio] = useState<ShakaAudioTrackOption[]>([]);
  const [text, setText] = useState<ShakaTextTrackOption[]>([]);
  const [video, setVideo] = useState<ShakaVideoQualityOption[]>([]);
  const [autoQuality, setAutoQuality] = useState(true);
  const [health, setHealth] = useState<AudioHealth>("unknown");
  const [audioNote, setAudioNote] = useState<string | null>(null);
  const [stats, setStats] = useState<{ height: number; width: number; buffer: number; dropped: number; bandwidth: number } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const resumeKey = `movie-${slug}`;

  // Dialog hygiene: Escape closes, the page behind does not scroll, and focus
  // starts on the close button so a keyboard user is never lost.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Remember where this title was left, shared with the title page player.
  useEffect(() => {
    if (!videoRef.current) return;
    startAtRef.current = resumePosition(loadResumePoint(resumeKey));
  }, [resumeKey]);

  /* --------------------------- attach the engine -------------------------- */

  const onTracks = useCallback((tracks: { audio: ShakaAudioTrackOption[]; text: ShakaTextTrackOption[]; video: ShakaVideoQualityOption[] }) => {
    setAudio(tracks.audio);
    setText(tracks.text);
    setVideo(tracks.video);
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !source) return;

    let disposed = false;
    let poll: number | undefined;
    let lastProgress = 0;
    let attempts = 0;
    let lastCounters: { audio: number | null; video: number | null; frames: number | null; at: number } | null = null;

    setStatus("loading");
    setErrorMessage(null);
    setAudioNote(null);
    setHealth("unknown");

    const attach = async () => {
      try {
        const handle = await attachShakaPlayback(videoEl, {
          url: source.url,
          streamType: source.type,
          container: source.container ?? null,
          fileName: source.label ?? null,
          startAt: startAtRef.current,
          preferredAudioLanguages: ["hi", "en"],
          onTracksChanged: onTracks,
          onFatalError: (error) => {
            if (disposed) return;
            setStatus("error");
            setErrorMessage(
              error.kind === "network"
                ? "The stream could not be reached. It may have expired — try another quality or open the title page."
                : "This browser could not decode the stream. Try another quality, or use the title page for a direct download."
            );
          },
        });
        if (disposed) {
          void handle.destroy();
          return;
        }
        handleRef.current = handle;
        setStatus("ready");
        setAutoQuality(true);
        void videoEl.play().catch(() => {
          /* autoplay may be blocked; the native controls remain */
        });

        const counters = videoEl as HTMLVideoElement & {
          webkitAudioDecodedByteCount?: number;
          webkitVideoDecodedByteCount?: number;
        };

        poll = window.setInterval(() => {
          if (disposed) return;

          // --- live stats -------------------------------------------------
          try {
            const qualities = handle.getVideoQualities();
            const active = qualities.find((entry) => entry.active);
            const buffered = videoEl.buffered;
            const ahead = buffered.length ? buffered.end(buffered.length - 1) - videoEl.currentTime : 0;
            const statsPlayer = handle.player as unknown as {
              getStats?: () => { estimatedBandwidth?: number; streamBandwidth?: number } | null;
            } | null;
            const statsPayload = typeof statsPlayer?.getStats === "function" ? statsPlayer.getStats() : null;
            setStats({
              height: active?.height ?? videoEl.videoHeight,
              width: active?.width ?? videoEl.videoWidth,
              buffer: Number.isFinite(ahead) ? Math.max(0, ahead) : 0,
              dropped: videoEl.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0,
              bandwidth: statsPayload?.estimatedBandwidth ?? statsPayload?.streamBandwidth ?? 0,
            });
          } catch {
            /* stats are cosmetic */
          }

          // --- audio watchdog --------------------------------------------
          const audioBytes = typeof counters.webkitAudioDecodedByteCount === "number" ? counters.webkitAudioDecodedByteCount : null;
          if (audioBytes === null) {
            setHealth("unknown");
            return;
          }
          const videoBytes = typeof counters.webkitVideoDecodedByteCount === "number" ? counters.webkitVideoDecodedByteCount : null;
          const frames = videoEl.getVideoPlaybackQuality?.().totalVideoFrames ?? null;
          const now = performance.now();
          const progress = videoEl.currentTime - lastProgress;

          if (!lastCounters) {
            lastCounters = { audio: audioBytes, video: videoBytes, frames, at: now };
            return;
          }
          const previousAudio = lastCounters.audio;
          const previousVideo = lastCounters.video;
          if (previousAudio === null) return;
          const audioDelta = audioBytes - previousAudio;
          const videoDelta = videoBytes !== null && previousVideo !== null ? videoBytes - previousVideo : null;
          const frameDelta = frames !== null && lastCounters.frames !== null ? frames - lastCounters.frames : null;
          lastCounters = { audio: audioBytes, video: videoBytes, frames, at: now };

          const verdict = audioHealthVerdict({
            progress: videoEl.paused ? 0 : progress,
            audioBytes: audioDelta,
            videoBytes: videoDelta,
            frames: frameDelta,
          });
          setHealth(verdict);

          if (verdict !== "silent") {
            if (verdict === "ok") {
              attempts = 0;
              setAudioNote(null);
            }
            return;
          }

          const action = nextAudioRecovery(attempts);
          attempts += 1;
          lastProgress = videoEl.currentTime;

          if (action === "switch-track") {
            const tracks = handle.getAudioTracks();
            if (tracks.length > 1) {
              const activeIndex = Math.max(0, tracks.findIndex((track) => track.active));
              const next = tracks[(activeIndex + 1) % tracks.length];
              handle.selectAudioTrack(next.id);
              setAudioNote(`Switched to ${describeAudioTrack(next)} — checking sound…`);
              return;
            }
          }

          if (action === "reload") {
            startAtRef.current = videoEl.currentTime > 1 ? videoEl.currentTime : startAtRef.current;
            setAudioNote("Reloading this stream at the same spot…");
            setReloadNonce((value) => value + 1);
            return;
          }

          setAudioNote(audioDiagnosis("silent", handle.getAudioTracks().length));
        }, AUDIO_SAMPLE_MS);
      } catch (error) {
        if (disposed) return;
        setStatus("error");
        setErrorMessage((error as Error)?.message || "The player could not start this stream.");
      }
    };

    void attach();

    return () => {
      disposed = true;
      window.clearInterval(poll);
      const activeHandle = handleRef.current;
      handleRef.current = null;
      if (activeHandle) void activeHandle.destroy();
      setAudio([]);
      setText([]);
      setVideo([]);
      setStats(null);
    };
    // `source` identity is what matters; the URL is inside it.
  }, [source, reloadNonce, onTracks]);

  /* ------------------------------ resume -------------------------------- */

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const onTime = () => {
      if (!element.duration || !Number.isFinite(element.duration)) return;
      const now = Date.now();
      if (now - lastSaveRef.current < RESUME_SAVE_MS) return;
      lastSaveRef.current = now;
      saveResumePoint(resumeKey, element.currentTime, element.duration);
    };
    element.addEventListener("timeupdate", onTime);
    return () => {
      element.removeEventListener("timeupdate", onTime);
      if (element.duration && Number.isFinite(element.duration) && element.currentTime > 1) {
        saveResumePoint(resumeKey, element.currentTime, element.duration);
      }
    };
  }, [resumeKey]);

  const selectSource = (index: number) => {
    startAtRef.current = videoRef.current?.currentTime ?? startAtRef.current;
    setSourceIndex(index);
    setReloadNonce((value) => value + 1);
  };

  const pickQuality = (height: number | "auto") => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.selectVideoQuality(height);
    setAutoQuality(height === "auto");
  };

  const pickAudio = (trackId: number) => {
    handleRef.current?.selectAudioTrack(trackId);
    setAudioNote(null);
    setHealth("unknown");
  };

  const pickText = (trackId: number | null) => {
    void handleRef.current?.selectTextTrack(trackId);
  };

  const retry = () => {
    startAtRef.current = videoRef.current?.currentTime ?? startAtRef.current;
    setReloadNonce((value) => value + 1);
  };

  const recommendations = query.data?.recommendations ?? [];

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/92 p-0 backdrop-blur-md desk:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Playing ${title?.title ?? fallbackTitle ?? "exclusive title"}`}
        className="fade-up relative w-full max-w-[1120px] overflow-hidden bg-surface ring-1 ring-edge desk:rounded-[18px]"
      >
        <header className="flex items-start gap-3 px-4 py-3 desk:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ExclusiveBadge compact />
              <span className="text-[11px] font-bold tracking-[0.08em] text-fg-3 uppercase">Now playing</span>
            </div>
            <h2 className="mt-1 truncate text-[20px] font-extrabold tracking-[-0.4px] desk:text-[24px]">
              {title?.title ?? fallbackTitle ?? "Loading…"}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-fg-2">
              {[title?.year, title?.genres?.[0]?.name, source?.label && `Stream ${source.label}`].filter(Boolean).join(" · ") ||
                "Exclusive collection"}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg"
          >
            <X size={17} />
          </button>
        </header>

        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            key={`${source?.url ?? "none"}-${reloadNonce}`}
            controls
            playsInline
            preload="metadata"
            poster={title?.backdrop ?? title?.poster ?? undefined}
            className="h-full w-full bg-black"
          >
            Your browser cannot play this media stream.
          </video>

          {status === "loading" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45">
              <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-[13px] font-semibold text-white">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Starting Shaka Player…
              </div>
            </div>
          )}

          {status === "empty" && (
            <div className="absolute inset-0 grid place-items-center bg-black px-6 text-center">
              <div>
                <p className="text-[15px] font-semibold text-white">No browser stream for this title</p>
                <p className="mt-1 max-w-sm text-[13px] text-white/70">
                  The collection has no DASH/HLS source here — open the title page for direct downloads and external players.
                </p>
              </div>
            </div>
          )}
        </div>

        {audioNote && (
          <div
            role="status"
            className="flex items-start gap-2 border-b border-edge bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-4 py-2.5 text-[12.5px] leading-relaxed text-fg desk:px-6"
          >
            <Volume2 size={15} className="mt-[1px] shrink-0 text-danger" aria-hidden="true" />
            <span>{audioNote}</span>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-wrap items-center gap-3 border-b border-edge bg-fill px-4 py-3 text-[13px] desk:px-6">
            <AlertTriangle size={16} className="shrink-0 text-danger" aria-hidden="true" />
            <span className="min-w-0 flex-1">{errorMessage ?? "This stream could not start."}</span>
            <Button variant="secondary" onClick={retry} className="h-8 px-3 text-[12.5px]">
              <RotateCcw size={13} aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}

        <div className="grid gap-4 px-4 py-4 desk:grid-cols-[1fr_260px] desk:px-6">
          <div className="min-w-0 space-y-3">
            {sources.length > 1 && (
              <div>
                <p className="mb-1.5 text-[11px] font-bold tracking-[0.08em] text-fg-3 uppercase">Streams</p>
                <div className="flex flex-wrap gap-1.5">
                  {sources.map((entry, index) => (
                    <button
                      key={`${entry.url}-${index}`}
                      type="button"
                      aria-pressed={index === sourceIndex}
                      onClick={() => selectSource(index)}
                      className={cx(
                        "h-8 rounded-full px-3 text-[12.5px] font-semibold",
                        index === sourceIndex ? "bg-primary text-on-primary" : "bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg"
                      )}
                    >
                      {entry.label || entry.type.toUpperCase()}
                      {entry.container ? ` · ${entry.container}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Menu label="Quality" icon={<Gauge size={14} aria-hidden="true" />} active={autoQuality ? "Auto" : qualityLabel(video)}>
                <MenuItem onClick={() => pickQuality("auto")} selected={autoQuality}>
                  Auto (adaptive)
                </MenuItem>
                {video.map((entry) => (
                  <MenuItem key={entry.id} onClick={() => pickQuality(entry.height ?? 0)} selected={!autoQuality && entry.active}>
                    {entry.height ? `${entry.height}p` : "Unknown"}
                    {entry.bandwidth ? ` · ${Math.round(entry.bandwidth / 1000)} kbps` : ""}
                  </MenuItem>
                ))}
                {video.length === 0 && <MenuItem disabled>No quality ladder exposed</MenuItem>}
              </Menu>

              <Menu
                label="Audio"
                icon={<Languages size={14} aria-hidden="true" />}
                active={audio.find((track) => track.active)?.label ?? (audio.length ? "Track 1" : "—")}
              >
                {audio.map((track) => (
                  <MenuItem key={track.id} onClick={() => pickAudio(track.id)} selected={track.active}>
                    {describeAudioTrack(track)}
                  </MenuItem>
                ))}
                {audio.length === 0 && <MenuItem disabled>No separate audio tracks</MenuItem>}
              </Menu>

              <Menu
                label="Subtitles"
                icon={<Captions size={14} aria-hidden="true" />}
                active={text.find((track) => track.active)?.label ?? "Off"}
              >
                <MenuItem onClick={() => pickText(null)} selected={!text.some((track) => track.active)}>
                  Off
                </MenuItem>
                {text.map((track) => (
                  <MenuItem key={track.id} onClick={() => pickText(track.id)} selected={track.active}>
                    {track.label}
                  </MenuItem>
                ))}
                {text.length === 0 && <MenuItem disabled>No subtitles in this stream</MenuItem>}
              </Menu>

              <span
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold",
                  health === "ok" && "bg-fill text-fg-2",
                  health === "silent" && "bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-danger",
                  (health === "unknown" || health === "pending") && "bg-fill text-fg-3"
                )}
                title="Audio watchdog: compares decoded audio with rendered video"
              >
                <Volume2 size={13} aria-hidden="true" />
                {health === "ok" ? "Audio OK" : health === "silent" ? "No sound" : health === "pending" ? "Checking audio…" : "Audio n/a"}
              </span>
            </div>

            {stats && (
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-fg-3 tabular-nums">
                <div className="flex gap-1">
                  <dt>Picture</dt>
                  <dd className="font-semibold text-fg-2">{stats.height ? `${stats.height}p` : "—"}{stats.width ? ` (${stats.width}×${stats.height})` : ""}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Buffer</dt>
                  <dd className="font-semibold text-fg-2">{stats.buffer.toFixed(1)}s</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Bandwidth</dt>
                  <dd className="font-semibold text-fg-2">{stats.bandwidth ? `${Math.round(stats.bandwidth / 1000)} kbps` : "—"}</dd>
                </div>
                <div className="flex gap-1">
                  <dt>Dropped</dt>
                  <dd className="font-semibold text-fg-2">{stats.dropped}</dd>
                </div>
              </dl>
            )}

            <p className="text-[12px] leading-relaxed text-fg-3">
              Adaptive DASH/HLS through Shaka Player, relayed same-origin so the collection&apos;s signed CDN
              authorisation survives. Audio and picture are separate tracks: if a surround track is silent in this
              browser, pick a stereo track above — the watchdog does it automatically first.
            </p>
          </div>

          <aside className="space-y-2 border-t border-edge pt-3 desk:border-t-0 desk:border-l desk:pt-0 desk:pl-4">
            <p className="text-[11px] font-bold tracking-[0.08em] text-fg-3 uppercase">This title</p>
            {title && (
              <Link
                href={mediaHref(title)}
                className="flex items-center justify-between gap-2 rounded-[10px] bg-fill px-3 py-2 text-[12.5px] font-semibold hover:bg-fill-2"
              >
                <span className="truncate">Details, cast &amp; downloads</span>
                <ExternalLink size={13} aria-hidden="true" className="shrink-0 text-fg-3" />
              </Link>
            )}
            <Button variant="secondary" onClick={retry} className="w-full justify-start text-[12.5px]">
              <RotateCcw size={13} aria-hidden="true" />
              Restart stream
            </Button>
            <p className="pt-1 text-[11px] text-fg-3">
              Playing time is remembered on this device, so the title page can continue from here.
            </p>
          </aside>
        </div>

        {recommendations.length > 0 && (
          <section aria-label="More from the exclusive collection" className="border-t border-edge px-4 py-3 desk:px-6">
            <p className="mb-2 text-[11px] font-bold tracking-[0.08em] text-fg-3 uppercase">More from the collection</p>
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {recommendations.slice(0, 10).map((item) => (
                <MiniTitle key={`${item.kind}-${item.slug}`} title={item} />
              ))}
            </div>
          </section>
        )}

        {query.isError && (
          <div className="border-t border-edge px-4 py-3 text-[13px] desk:px-6">
            <p className="text-fg-2">The title details could not be loaded, but the player can still use the collection listing.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- controls -------------------------------- */

function qualityLabel(video: ShakaVideoQualityOption[]): string {
  const active = video.find((entry) => entry.active);
  return active?.height ? `${active.height}p` : "—";
}

function MiniTitle({ title }: { title: MediaTitle }) {
  return (
    <Link
      href={mediaHref(title)}
      className="group/mini w-[104px] shrink-0"
      title={title.title}
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-[8px] bg-raised ring-1 ring-edge">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={title.poster ?? title.backdrop ?? ""}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform group-hover/mini:scale-105"
        />
      </div>
      <p className="mt-1 truncate text-[11.5px] font-medium">{title.title}</p>
    </Link>
  );
}

function Menu({
  label,
  icon,
  active,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group/menu relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full bg-fill px-3 text-[12px] font-semibold text-fg-2 hover:bg-fill-2 hover:text-fg">
        {icon}
        <span className="text-fg-3">{label}</span>
        <span className="max-w-[110px] truncate text-fg">{active}</span>
        <ChevronDown size={12} aria-hidden="true" className="text-fg-3 transition-transform group-open/menu:rotate-180" />
      </summary>
      <div
        role="menu"
        className="absolute bottom-full left-0 z-20 mb-1.5 max-h-[260px] w-[220px] overflow-y-auto rounded-[10px] bg-raised p-1 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] ring-1 ring-edge"
      >
        {children}
      </div>
    </details>
  );
}

function MenuItem({
  children,
  onClick,
  selected,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={Boolean(selected)}
      disabled={disabled}
      onClick={(event) => {
        if (disabled) return;
        onClick?.();
        event.currentTarget.closest("details")?.removeAttribute("open");
      }}
      className={cx(
        "flex w-full items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[12.5px]",
        disabled ? "cursor-default text-fg-3" : "text-fg-2 hover:bg-fill-2 hover:text-fg",
        selected && "font-semibold text-fg"
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {selected && <span aria-hidden="true">✓</span>}
    </button>
  );
}

/** Time formatting re-export, so callers of the sheet do not import two modules. */
export { formatPlaybackTime };
