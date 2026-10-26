"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Bookmark,
  Captions,
  Check,
  Copy,
  Download,
  ExternalLink,
  Languages,
  ListVideo,
  Play,
  RotateCcw,
  RotateCw,
  Star,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { mediaArt } from "@/lib/media/art";
import { audioVerdict, externalPlayerReleases, playableReleases } from "@/lib/media/playbackPlan";
import {
  clearResumePoint,
  formatPlaybackTime,
  loadResumePoint,
  resumePosition,
  saveResumePoint,
} from "@/lib/media/resumePoints";
import type {
  ShakaAudioTrackOption,
  ShakaPlaybackHandle,
  ShakaTextTrackOption,
} from "@/lib/media/shakaPlayer";
import type { MediaDetail, PlaybackSource } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { SectionHeader, Shelf } from "@/components/ui";
import { useUi } from "@/store/ui";
import { useWatchlist } from "@/store/watchlist";
import { cx, formatBytes } from "@/lib/format";
import { BetaBadge } from "./BetaBadge";
import { ExclusiveBadge } from "./ExclusiveBadge";
import { PosterCard, isExclusiveTitle, posterShelfClass } from "./PosterCard";
import { VlcPlayButton } from "./VlcPlayButton";
import { useResumePoint } from "./useResumePoint";
import { MovieWatchSection, SeasonTabsSection } from "./WatchSections";
import type { WatchTarget } from "./watch";

const BetaPlayerSheet = dynamic(() => import("./BetaPlayerSheet").then((m) => m.BetaPlayerSheet), { ssr: false });
const QualityPickerSheet = dynamic(() => import("./QualityPickerSheet").then((m) => m.QualityPickerSheet), { ssr: false });
const TrailerSheet = dynamic(() => import("./TrailerSheet").then((m) => m.TrailerSheet), { ssr: false });
const VlcPickerSheet = dynamic(() => import("./VlcPickerSheet").then((m) => m.VlcPickerSheet), { ssr: false });

/** Everything on a /movies/[slug] or /series/[slug] page. */
export default function MediaDetailView({ detail }: { detail: MediaDetail }) {
  const { title, seasons, related } = detail;
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [backdropBroken, setBackdropBroken] = useState(false);
  const [posterBroken, setPosterBroken] = useState(false);

  const [activeStreamIndex, setActiveStreamIndex] = useState(0);
  // One item (movie / episode / season packs) at a time in each sheet.
  const [downloadTarget, setDownloadTarget] = useState<WatchTarget | null>(null);
  const [playTarget, setPlayTarget] = useState<WatchTarget | null>(null);
  const [vlcTarget, setVlcTarget] = useState<WatchTarget | null>(null);

  const saved = useWatchlist((s) => s.items.some((item) => item.id === `${title.kind}:${title.slug}`));
  const toggle = useWatchlist((s) => s.toggle);

  const allPlayback: PlaybackSource[] = detail.playback;
  const releases = useMemo(() => detail.releases ?? [], [detail.releases]);
  const posterUrl = title.poster ?? title.backdrop ?? undefined;
  const isSeries = title.kind === "series";

  // A movie is ONE item whose releases are its qualities.
  const movieTarget = useMemo<WatchTarget | null>(
    () =>
      !isSeries && releases.length > 0
        ? { key: `movie-${title.slug}`, heading: title.title, mediaTitle: title.title, releases, poster: posterUrl }
        : null,
    [isSeries, releases, title.slug, title.title, posterUrl]
  );
  const movieCanPlay = movieTarget ? playableReleases(movieTarget.releases).length > 0 : false;
  const movieCanStream = movieTarget ? externalPlayerReleases(movieTarget.releases).length > 0 : false;
  const movieResumeAt = useResumePoint(movieTarget?.key);
  const hasSeasonTabs = isSeries && (seasons.length > 0 || releases.length > 0);
  const hasEpisodeFiles = seasons.some((season) => season.episodes.some((episode) => (episode.releases?.length ?? 0) > 0));

  const openPlay = useCallback((target: WatchTarget) => {
    setDownloadTarget(null);
    setVlcTarget(null);
    setPlayTarget(target);
  }, []);
  const openVlc = useCallback((target: WatchTarget) => {
    setPlayTarget(null);
    setDownloadTarget(null);
    setVlcTarget(target);
  }, []);
  const openDownload = useCallback((target: WatchTarget) => {
    setPlayTarget(null);
    setVlcTarget(null);
    setDownloadTarget(target);
  }, []);
  const closePlay = useCallback(() => setPlayTarget(null), []);
  const closeVlc = useCallback(() => setVlcTarget(null), []);
  const closeDownload = useCallback(() => setDownloadTarget(null), []);

  const backdrop = backdropBroken
    ? mediaArt(null, { seed: title.slug, accent: title.accent, ratio: "backdrop" })
    : mediaArt(title.backdrop ?? title.poster, { seed: title.slug, accent: title.accent, ratio: "backdrop" });
  const poster = posterBroken
    ? mediaArt(null, { seed: title.slug, accent: title.accent })
    : mediaArt(title.poster, { seed: title.slug, accent: title.accent });

  const meta = [
    title.year,
    title.kind === "movie"
      ? title.runtimeMinutes
        ? formatRuntime(title.runtimeMinutes)
        : ""
      : title.seasonCount
        ? `${title.seasonCount} season${title.seasonCount === 1 ? "" : "s"}`
        : "",
    title.kind === "series" && title.episodeCount ? `${title.episodeCount} episodes` : "",
    title.certification,
    title.languageName ?? title.language.toUpperCase(),
  ].filter(Boolean);

  return (
    <>
      <article className="fade-up">
        <header className="relative isolate overflow-hidden text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={backdrop}
            alt=""
            aria-hidden="true"
            decoding="async"
            draggable={false}
            onError={() => setBackdropBroken(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.62) 48%, rgba(0,0,0,0.38) 100%), linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.5) 62%, rgba(0,0,0,0.82) 100%)",
            }}
          />
          <div className="relative px-4 pt-8 pb-8 desk:px-8 desk:pt-12 desk:pb-10">
            <div className="flex flex-col gap-5 desk:flex-row desk:items-end desk:gap-8">
              <div className="w-[118px] shrink-0 overflow-hidden rounded-[12px] shadow-[0_18px_50px_-14px_rgba(0,0,0,0.8)] ring-1 ring-white/15 desk:w-[216px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={poster}
                  alt={`${title.title} poster`}
                  decoding="async"
                  onError={() => setPosterBroken(true)}
                  className="aspect-[2/3] w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="t-eyebrow rounded-full bg-white/15 px-2.5 py-1 text-white/90 backdrop-blur-md">
                    {title.kind === "movie" ? "Film" : "Series"}
                  </span>
                  {title.demo && (
                    <span className="rounded-full bg-white/12 px-2 py-[3px] text-[10px] font-bold tracking-[0.06em] text-white/75 uppercase">
                      Demo title
                    </span>
                  )}
                  {isExclusiveTitle(title) && <ExclusiveBadge className="bg-white/15 text-white/90" />}
                  {title.free && !title.demo && (
                    <span className="rounded-full bg-primary px-2 py-[3px] text-[10px] font-bold tracking-[0.06em] text-on-primary uppercase">
                      Free to stream
                    </span>
                  )}
                  {typeof title.rating === "number" && title.rating > 0 && (
                    <span className="flex items-center gap-1 text-[12px] font-semibold text-white/85">
                      <Star size={12} fill="currentColor" aria-hidden="true" />
                      {title.rating.toFixed(1)}
                      <span className="sr-only">out of 10</span>
                    </span>
                  )}
                  {title.quality && (
                    <span className="rounded-[4px] bg-white/90 px-1.5 py-[2px] text-[10px] font-black tracking-[0.04em] text-black uppercase">
                      {title.quality}
                    </span>
                  )}
                  {title.audioLanguages && title.audioLanguages.length > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-white/12 px-2 py-[3px] text-[10.5px] font-semibold text-white/80">
                      <Languages size={11} aria-hidden="true" />
                      {title.audioLanguages.slice(0, 3).join(" · ")}
                    </span>
                  )}
                </div>
                <h1 className="text-[30px] leading-[1.05] font-extrabold tracking-[-0.7px] desk:text-[46px] desk:tracking-[-1.2px]">
                  {title.title}
                </h1>
                {title.tagline && <p className="mt-1.5 text-[14px] text-white/70 italic">“{title.tagline}”</p>}
                {meta.length > 0 && (
                  <p className="mt-2 text-[12px] font-semibold tracking-[0.05em] text-white/60 uppercase">{meta.join(" · ")}</p>
                )}
                {title.genres.length > 0 && (
                  <p className="mt-1 text-[13px] text-white/75">{title.genres.map((g) => g.name).join(" · ")}</p>
                )}
                {(title.director?.length || title.cast?.length) && (
                  <p className="mt-2 max-w-[680px] text-[12.5px] leading-relaxed text-white/65">
                    {title.director?.length ? (
                      <>
                        <span className="font-semibold text-white/80">Director:</span> {title.director.join(", ")}
                      </>
                    ) : null}
                    {title.director?.length && title.cast?.length ? <span className="px-2 text-white/35">|</span> : null}
                    {title.cast?.length ? (
                      <>
                        <span className="font-semibold text-white/80">Cast:</span> {title.cast.slice(0, 6).join(", ")}
                      </>
                    ) : null}
                  </p>
                )}
                <p className="mt-3 max-w-[680px] text-[14px] leading-relaxed text-white/85 desk:text-[15px]">{title.overview}</p>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  {allPlayback.length > 0 ? (
                    <a
                      href="#play"
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                    >
                      <Play size={16} fill="currentColor" aria-hidden="true" /> Play
                    </a>
                  ) : movieTarget ? (
                    <>
                      {movieCanPlay && (
                        <button
                          type="button"
                          onClick={() => openPlay(movieTarget)}
                          className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                        >
                          <Play size={16} fill="currentColor" aria-hidden="true" />{" "}
                          {movieResumeAt !== null ? `Resume ${formatPlaybackTime(movieResumeAt)}` : "Try Play"}
                          <BetaBadge tone="onWhite" />
                        </button>
                      )}
                      {movieCanStream && (
                        <VlcPlayButton
                          title={movieTarget.mediaTitle}
                          heading={movieTarget.heading}
                          releases={movieTarget.releases}
                          onOpen={() => openVlc(movieTarget)}
                          iconSize={16}
                          className={
                            "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition-colors hover:bg-white/24 active:scale-[0.97]"
                          }
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => openDownload(movieTarget)}
                        className={cx(
                          "inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-colors",
                          movieCanPlay
                            ? "bg-white/16 text-white ring-1 ring-white/20 backdrop-blur-xl hover:bg-white/24"
                            : "bg-white text-black hover:opacity-90"
                        )}
                      >
                        <Download size={16} aria-hidden="true" /> Download
                      </button>
                    </>
                  ) : hasSeasonTabs ? (
                    <a
                      href="#episodes"
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                    >
                      <ListVideo size={16} aria-hidden="true" /> Episodes
                    </a>
                  ) : title.trailer ? (
                    <button
                      type="button"
                      onClick={() => setTrailerOpen(true)}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                    >
                      <Play size={16} fill="currentColor" aria-hidden="true" /> Watch trailer
                    </button>
                  ) : null}

                  {(allPlayback.length > 0 || movieTarget || hasSeasonTabs) && title.trailer && (
                    <button
                      type="button"
                      onClick={() => setTrailerOpen(true)}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition-colors hover:bg-white/24"
                    >
                      Trailer
                    </button>
                  )}

                  <button
                    type="button"
                    aria-pressed={saved}
                    onClick={() => toggle(title)}
                    className={cx(
                      "inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold backdrop-blur-xl transition-colors",
                      saved ? "bg-white text-black" : "bg-white/16 text-white ring-1 ring-white/20 hover:bg-white/24"
                    )}
                  >
                    {saved ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
                    {saved ? "In watchlist" : "Watchlist"}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
            style={{ background: "linear-gradient(180deg, transparent, var(--bg))" }}
            aria-hidden="true"
          />
        </header>

        <div className="mt-6 space-y-8">
          {(allPlayback.length > 0 || (releases.length === 0 && !hasEpisodeFiles)) && (
            <PlaybackSection
              playback={allPlayback}
              active={activeStreamIndex}
              onSelectActive={setActiveStreamIndex}
              detail={detail}
            />
          )}

          {movieTarget && (
            <MovieWatchSection title={title} target={movieTarget} onPlay={openPlay} onVlc={openVlc} onDownload={openDownload} />
          )}

          {hasSeasonTabs && (
            <SeasonTabsSection
              slug={title.slug}
              title={title}
              seasons={seasons}
              releases={releases}
              poster={posterUrl}
              onPlay={openPlay}
              onVlc={openVlc}
              onDownload={openDownload}
            />
          )}

          {related.length > 0 && (
            <section className="mb-8">
              <SectionHeader title="More like this" />
              <Shelf>
                {related.map((item) => (
                  <PosterCard key={`${item.kind}-${item.id}`} title={item} className={posterShelfClass} />
                ))}
              </Shelf>
            </section>
          )}
        </div>

        <div className="mt-6 px-4 pb-4 desk:px-8">
          <Link
            href={title.kind === "movie" ? "/movies" : "/series"}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-playing hover:opacity-80"
          >
            ← Back to all {title.kind === "movie" ? "movies" : "series"}
          </Link>
        </div>
      </article>

      {/* Sheets live outside the animated <article>: its `fade-up` transform animation would
          otherwise become the containing block of the sheets' `position: fixed` overlay. */}
      {trailerOpen && (
        <TrailerSheet open={trailerOpen} onClose={() => setTrailerOpen(false)} trailer={title.trailer} title={title.title} />
      )}
      {vlcTarget && <VlcPickerSheet target={vlcTarget} onClose={closeVlc} />}
      {downloadTarget && <QualityPickerSheet target={downloadTarget} onClose={closeDownload} />}
      {playTarget && (
        <BetaPlayerSheet target={playTarget} onClose={closePlay} onOpenVlc={openVlc} onDownload={openDownload} />
      )}
    </>
  );
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ------------------------------- playback -------------------------------- */

type StreamShakaMode = ShakaPlaybackHandle["mode"];

function MediaStreamPlayer({
  source,
  poster,
  videoRef,
  shakaHandleRef,
  onModeChange,
  onTracksChange,
  onStreamError,
}: {
  source: PlaybackSource;
  poster?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  shakaHandleRef: React.RefObject<ShakaPlaybackHandle | null>;
  onModeChange: (url: string, mode: StreamShakaMode) => void;
  onTracksChange: (tracks: { audio: ShakaAudioTrackOption[]; text: ShakaTextTrackOption[] }) => void;
  onStreamError: (url: string, message: string) => void;
}) {
  useEffect(() => {
    const videoEl = videoRef.current as (HTMLVideoElement & {
      webkitAudioDecodedByteCount?: number;
      webkitVideoDecodedByteCount?: number;
    }) | null;
    if (!videoEl) return;

    let disposed = false;
    let audioMonitorTimer: number | undefined;
    let upgradingMp4 = false;
    const abortCtrl = new AbortController();

    // Attach one task later so React StrictMode double-mount creates one clean Shaka instance per <video>.
    const timer = window.setTimeout(() => {
      void import("@/lib/media/shakaPlayer")
        .then(({ attachShakaPlayback }) =>
          attachShakaPlayback(videoEl, {
            url: source.url,
            streamType: source.type,
            fileName: source.label,
            signal: abortCtrl.signal,
            onTracksChanged: (tracks) => {
              if (!disposed) onTracksChange(tracks);
            },
            onFatalError: (err) => {
              if (!disposed) {
                onStreamError(source.url, `Shaka Player error (${err.kind}): ${err.detail}`);
              }
            },
          })
        )
        .then((handle) => {
          if (disposed) {
            void handle.destroy();
            return;
          }
          shakaHandleRef.current = handle;
          onModeChange(source.url, handle.mode);

          // If loaded as progressive src= MP4 with hidden Dolby audio, monitor decoded audio bytes
          // and transparently upgrade in-place to Shaka MP4-MSE + WASM Dolby transcoding.
          if (handle.mode === "shaka-src" && handle.mimeType === "video/mp4") {
            const onPlaying = () => {
              const startSec = videoEl.currentTime;
              const startFrames = videoEl.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
              const poll = () => {
                if (disposed || upgradingMp4 || videoEl.paused) return;
                const verdict = audioVerdict({
                  progress: videoEl.currentTime - startSec,
                  audioBytes: videoEl.webkitAudioDecodedByteCount,
                  videoBytes: videoEl.webkitVideoDecodedByteCount,
                  frames: (videoEl.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) - startFrames,
                });
                if (verdict === "silent") {
                  upgradingMp4 = true;
                  void handle.upgradeProgressiveMp4ToMse(videoEl.currentTime).then((ok) => {
                    upgradingMp4 = false;
                    if (!disposed && ok) {
                      onModeChange(source.url, handle.mode);
                      void videoEl.play().catch(() => {});
                    }
                  });
                } else if (verdict === "pending") {
                  audioMonitorTimer = window.setTimeout(poll, 300);
                }
              };
              audioMonitorTimer = window.setTimeout(poll, 400);
            };
            videoEl.addEventListener("playing", onPlaying, { once: true });
          }
        })
        .catch((err: unknown) => {
          if (disposed || abortCtrl.signal.aborted) return;
          onStreamError(
            source.url,
            (err as { message?: string } | null)?.message ||
              "Shaka Player could not initialize this media stream.",
          );
        });
    }, 0);

    return () => {
      disposed = true;
      abortCtrl.abort();
      window.clearTimeout(timer);
      window.clearTimeout(audioMonitorTimer);
      onTracksChange({ audio: [], text: [] });
      const activeHandle = shakaHandleRef.current;
      shakaHandleRef.current = null;
      if (activeHandle) {
        void activeHandle.destroy();
      }
    };
  }, [source, videoRef, shakaHandleRef, onModeChange, onTracksChange, onStreamError]);

  return (
    <video
      key={source.url}
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      poster={poster}
      onError={(e) => {
        const el = e.currentTarget;
        if (el.error) {
          onStreamError(
            source.url,
            "Browser video element rejected this stream (unsupported audio/video codec, expired direct URL, or cross-origin media policy). Open the link in VLC / IINA / MPV or download directly."
          );
        }
      }}
      className="aspect-video w-full bg-black"
    >
      Your browser cannot play this media stream natively.
    </video>
  );
}

/**
 * ⟲ 10s / 10s ⟳ and "continue from where you stopped" for the operator stream player.
 * Positions are saved only while a source is loaded (readyState ≥ 1), so tearing a source
 * down never overwrites the saved spot with 0.
 */
function StreamExtras({
  videoRef,
  resumeKey,
  sourceUrl,
  title,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  resumeKey: string;
  sourceUrl: string;
  title: string;
}) {
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stored = resumePosition(loadResumePoint(resumeKey));
    let restored = false;
    let lastSaved = 0;
    const loaded = () => video.readyState >= 1 && Boolean(video.currentSrc) && Number.isFinite(video.currentTime);
    const save = () => {
      if (!loaded()) return;
      lastSaved = video.currentTime;
      saveResumePoint(resumeKey, video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
    };
    const onMetadata = () => {
      if (restored || stored === null) return;
      restored = true;
      if (Number.isFinite(video.duration) && stored >= video.duration - 1) return;
      try {
        video.currentTime = stored;
        setResumedFrom(stored);
      } catch {
        /* not seekable yet */
      }
    };
    const onTime = () => {
      if (loaded() && Math.abs(video.currentTime - lastSaved) >= 5) save();
    };
    const onPause = () => {
      if (!video.ended) save();
    };
    const onEnded = () => clearResumePoint(resumeKey);
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    video.addEventListener("loadedmetadata", onMetadata);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    if (video.readyState >= 1) onMetadata();
    return () => {
      save();
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
    };
  }, [videoRef, resumeKey, sourceUrl]);

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video || video.readyState < 1 || !Number.isFinite(video.currentTime)) return;
    const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.25) : Number.POSITIVE_INFINITY;
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + delta));
  };

  const startOver = () => {
    clearResumePoint(resumeKey);
    setResumedFrom(null);
    const video = videoRef.current;
    if (video && video.readyState >= 1) video.currentTime = 0;
  };

  const chipClass =
    "inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3";
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <button type="button" onClick={() => seekBy(-10)} aria-label="Back 10 seconds" title="Back 10 seconds" className={chipClass}>
        <RotateCcw size={14} aria-hidden="true" /> 10s
      </button>
      <button type="button" onClick={() => seekBy(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds" className={chipClass}>
        10s <RotateCw size={14} aria-hidden="true" />
      </button>
      <VlcPlayButton url={sourceUrl} title={title} className={chipClass} />
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
  );
}

function PlaybackSection({
  playback,
  active,
  onSelectActive,
  detail,
}: {
  playback: PlaybackSource[];
  active: number;
  onSelectActive: (idx: number) => void;
  detail: MediaDetail;
}) {
  const { title } = detail;
  const pushToast = useUi((s) => s.pushToast);
  const [failedReasons, setFailedReasons] = useState<Record<string, string>>({});
  const [streamModes, setStreamModes] = useState<Record<string, StreamShakaMode>>({});
  const [audioTracks, setAudioTracks] = useState<ShakaAudioTrackOption[]>([]);
  const [textTracks, setTextTracks] = useState<ShakaTextTrackOption[]>([]);
  const streamVideoRef = useRef<HTMLVideoElement | null>(null);
  const shakaHandleRef = useRef<ShakaPlaybackHandle | null>(null);
  const downloads = detail.downloads ?? [];

  // Stable callbacks, so reporting a mode/error doesn't re-run (and re-attach) the player.
  const handleStreamError = useCallback((url: string, reason: string) => {
    setFailedReasons((prev) => (prev[url] === reason ? prev : { ...prev, [url]: reason }));
  }, []);

  const handleModeChange = useCallback((url: string, mode: StreamShakaMode) => {
    setStreamModes((prev) => (prev[url] === mode ? prev : { ...prev, [url]: mode }));
  }, []);

  const handleTracksChange = useCallback(
    ({ audio, text }: { audio: ShakaAudioTrackOption[]; text: ShakaTextTrackOption[] }) => {
      setAudioTracks(audio);
      setTextTracks(text);
    },
    [],
  );

  if (playback.length === 0) {
    const links = title.watchProviders ?? [];
    return (
      <section aria-labelledby="where-to-watch" className="px-4 desk:px-8">
        <div className="rounded-[16px] bg-raised/70 p-4 ring-1 ring-edge desk:p-5">
          <h2 id="where-to-watch" className="t-title">
            Playback &amp; availability
          </h2>
          <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-relaxed text-fg-2">
            No verified browser-compatible stream is currently loaded for this title.{" "}
            {links.length > 0
              ? "Use the availability links below to locate official streaming options."
              : "Check the release mirrors or official page if available."}
          </p>
          {links.length > 0 && (
            <>
              <ul className="mt-3 flex flex-wrap gap-2">
                {links.map((link) => (
                  <li key={`${link.name}-${link.url}`}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3.5 py-2 text-[13px] font-semibold transition-colors hover:bg-fill-2"
                    >
                      {link.name}
                      {link.kind && <span className="text-[11px] font-medium text-fg-2">{link.kind}</span>}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11.5px] text-fg-3">Availability varies by country and can change over time.</p>
            </>
          )}
          {title.officialUrl && (
            <a
              href={title.officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-playing hover:opacity-80"
            >
              Source page <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </section>
    );
  }

  const boundedIndex = Math.min(active, playback.length - 1);
  const source = playback[boundedIndex];
  const embed = source.type === "embed";
  const failureMessage = failedReasons[source.url];
  const activeMode = streamModes[source.url];

  const copyStreamUrl = async () => {
    try {
      await copyText(source.url);
      pushToast({ title: "Copied stream URL to clipboard", kind: "ok" });
    } catch {
      pushToast({ title: "Clipboard unavailable", desc: "Right-click Open stream URL to copy.", kind: "warn" });
    }
  };

  return (
    <section id="play" aria-labelledby="authorized-playback" className="px-4 desk:px-8">
      <div className="overflow-hidden rounded-[16px] bg-black ring-1 ring-edge">
        {embed ? (
          <iframe
            src={source.url}
            title={`${title.title} — player`}
            allow="autoplay; fullscreen; encrypted-media"
            loading="lazy"
            className="aspect-video w-full bg-black"
          />
        ) : (
          <MediaStreamPlayer
            source={source}
            poster={title.backdrop ?? title.poster ?? undefined}
            videoRef={streamVideoRef}
            shakaHandleRef={shakaHandleRef}
            onModeChange={handleModeChange}
            onTracksChange={handleTracksChange}
            onStreamError={handleStreamError}
          />
        )}
      </div>
      {!embed && (
        <StreamExtras
          videoRef={streamVideoRef}
          resumeKey={`stream-${title.kind}-${title.slug}`}
          sourceUrl={source.url}
          title={title.title}
        />
      )}

      {!embed && audioTracks.length > 1 && (
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

      {!embed && textTracks.length > 0 && (
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

      {failureMessage && (
        <div
          role="alert"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-danger/12 px-3.5 py-2.5 text-[12.5px] text-fg ring-1 ring-danger/30"
        >
          <span>{SOMETHING_WENT_WRONG}</span>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void copyStreamUrl()}
              className="inline-flex items-center gap-1 rounded-full bg-fill-2 px-3 py-1.5 text-[12px] font-semibold hover:bg-fill-3"
            >
              <Copy size={12} aria-hidden="true" /> Copy stream URL
            </button>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded-full bg-fill-2 px-3 py-1.5 text-[12px] font-semibold hover:bg-fill-3"
            >
              Open stream URL <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h2 id="authorized-playback" className="text-[13px] font-semibold text-fg-2">
          {source.label || (embed ? "Embedded player" : "Browser stream")}
        </h2>
        {!embed && activeMode && activeMode !== "unsupported" && (
          <span className="rounded-full bg-fill px-2.5 py-0.5 text-[11px] font-semibold text-fg-3">
            {activeMode === "shaka-mse"
              ? `Shaka MSE · ${source.type.toUpperCase()}`
              : `Shaka · ${source.type.toUpperCase()}`}
          </span>
        )}
        {playback.length > 1 &&
          playback.map((item, index) => (
            <button
              key={item.url}
              type="button"
              onClick={() => onSelectActive(index)}
              aria-pressed={index === boundedIndex}
              aria-label={`Playback option ${index + 1}`}
              className={cx(
                "h-6 min-w-6 rounded-full px-2.5 text-[12px] font-semibold tabular-nums transition-colors",
                index === boundedIndex ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
              )}
            >
              {item.label ? `${index + 1}. ${item.label}` : index + 1}
            </button>
          ))}
      </div>
      {source.note && <p className="mt-1.5 max-w-[680px] text-[11.5px] leading-relaxed text-fg-3">{source.note}</p>}

      {downloads.length > 0 && (
        <div className="mt-3" aria-labelledby="downloads-heading">
          <h2 id="downloads-heading" className="text-[13px] font-semibold text-fg-2">
            Download
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {downloads.map((entry) => (
              <li key={entry.url}>
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3.5 py-2 text-[13px] font-semibold transition-colors hover:bg-fill-2"
                >
                  <Download size={13} aria-hidden="true" />
                  {entry.label}
                  {entry.sizeBytes ? <span className="text-[11px] font-medium text-fg-2">{formatBytes(entry.sizeBytes)}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
