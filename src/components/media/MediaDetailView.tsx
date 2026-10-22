"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Copy, Download, ExternalLink, ListVideo, Play, RotateCcw, RotateCw, Star } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { mediaArt } from "@/lib/media/art";
import { attachPlaybackSource, type HlsPlaybackMode } from "@/lib/media/hlsPlayer";
import { externalPlayerReleases, playableReleases } from "@/lib/media/playbackPlan";
import {
  clearResumePoint,
  formatPlaybackTime,
  loadResumePoint,
  resumePosition,
  saveResumePoint,
} from "@/lib/media/resumePoints";
import type { MediaDetail, PlaybackSource } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { SectionHeader, Shelf } from "@/components/ui";
import { useUi } from "@/store/ui";
import { useWatchlist } from "@/store/watchlist";
import { cx, formatBytes } from "@/lib/format";
import { BetaBadge, BetaPlayerSheet } from "./BetaPlayerSheet";
import { PosterCard, posterShelfClass } from "./PosterCard";
import { QualityPickerSheet } from "./QualityPickerSheet";
import { TrailerSheet } from "./TrailerSheet";
import { VlcPlayButton } from "./VlcPlayButton";
import { useResumePoint } from "./useResumePoint";
import { MovieWatchSection, SeasonTabsSection } from "./WatchSections";
import type { WatchTarget } from "./watch";

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
    setPlayTarget(target);
  }, []);
  const openDownload = useCallback((target: WatchTarget) => {
    setPlayTarget(null);
    setDownloadTarget(target);
  }, []);
  const closePlay = useCallback(() => setPlayTarget(null), []);
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
                          releases={movieTarget.releases}
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
            <MovieWatchSection title={title} target={movieTarget} onPlay={openPlay} onDownload={openDownload} />
          )}

          {hasSeasonTabs && (
            <SeasonTabsSection
              slug={title.slug}
              title={title}
              seasons={seasons}
              releases={releases}
              poster={posterUrl}
              onPlay={openPlay}
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
      <TrailerSheet open={trailerOpen} onClose={() => setTrailerOpen(false)} trailer={title.trailer} title={title.title} />
      <QualityPickerSheet target={downloadTarget} onClose={closeDownload} />
      <BetaPlayerSheet target={playTarget} onClose={closePlay} onDownload={openDownload} />
    </>
  );
}

function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ------------------------------- playback -------------------------------- */

function MediaStreamPlayer({
  source,
  poster,
  videoRef,
  onModeChange,
  onStreamError,
}: {
  source: PlaybackSource;
  poster?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onModeChange: (url: string, mode: HlsPlaybackMode) => void;
  onStreamError: (url: string, message: string) => void;
}) {

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

    // Attach one task later: an effect that is torn down and re-run straight away (React
    // StrictMode, or a re-render with new callbacks) then attaches once, instead of a stale
    // attach's late `destroy()` wiping the `src` the newer attach just set.
    const timer = window.setTimeout(() => {
      void attachPlaybackSource({
        video: videoEl,
        source,
        onMode: (mode) => {
          if (!disposed) onModeChange(source.url, mode);
        },
        onFatalError: (reason) => {
          if (!disposed) onStreamError(source.url, reason);
        },
      }).then((handle) => {
        if (disposed) {
          handle.destroy();
        } else {
          teardown = handle.destroy;
        }
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      teardown?.();
    };
  }, [source, videoRef, onModeChange, onStreamError]);

  return (
    <video
      key={source.url}
      ref={videoRef}
      controls
      playsInline
      preload="metadata"
      poster={poster}
      onError={() =>
        onStreamError(
          source.url,
          "Browser video element rejected this stream (unsupported audio/video codec, expired direct URL, or cross-origin media policy). Open the link in VLC / IINA / MPV or download directly."
        )
      }
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
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  resumeKey: string;
  sourceUrl: string;
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
  const [streamModes, setStreamModes] = useState<Record<string, HlsPlaybackMode>>({});
  const streamVideoRef = useRef<HTMLVideoElement | null>(null);
  const downloads = detail.downloads ?? [];

  // Stable callbacks, so reporting a mode/error doesn't re-run (and re-attach) the player.
  const handleStreamError = useCallback((url: string, reason: string) => {
    setFailedReasons((prev) => (prev[url] === reason ? prev : { ...prev, [url]: reason }));
  }, []);

  const handleModeChange = useCallback((url: string, mode: HlsPlaybackMode) => {
    setStreamModes((prev) => (prev[url] === mode ? prev : { ...prev, [url]: mode }));
  }, []);

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
            allowFullScreen
            loading="lazy"
            className="aspect-video w-full bg-black"
          />
        ) : (
          <MediaStreamPlayer
            source={source}
            poster={title.backdrop ?? title.poster ?? undefined}
            videoRef={streamVideoRef}
            onModeChange={handleModeChange}
            onStreamError={handleStreamError}
          />
        )}
      </div>
      {!embed && <StreamExtras videoRef={streamVideoRef} resumeKey={`stream-${title.kind}-${title.slug}`} sourceUrl={source.url} />}

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
            {activeMode === "native-hls"
              ? "Native HLS"
              : activeMode === "mse-hls"
                ? "HLS · hls.js MSE"
                : `Direct ${source.type.toUpperCase()}`}
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
