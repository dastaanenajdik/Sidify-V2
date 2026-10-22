"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Star,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { mediaArt } from "@/lib/media/art";
import { mediaApi, MediaApiError } from "@/lib/media/client";
import { attachPlaybackSource, type HlsPlaybackMode } from "@/lib/media/hlsPlayer";
import { useSeasonEpisodes } from "@/lib/media/hooks";
import type {
  Episode,
  MediaDetail,
  MediaMirror,
  MediaReleaseItem,
  MirrorResolveResult,
  PlaybackSource,
  ResolvedMirrorLink,
  Season,
} from "@/lib/media/types";
import { SectionHeader, Shelf } from "@/components/ui";
import { useUi } from "@/store/ui";
import { useWatchlist } from "@/store/watchlist";
import { cx, formatBytes } from "@/lib/format";
import { PosterCard, posterShelfClass } from "./PosterCard";
import { TrailerSheet } from "./TrailerSheet";

/** Everything on a /movies/[slug] or /series/[slug] page. */
export default function MediaDetailView({ detail }: { detail: MediaDetail }) {
  const { title, seasons, related } = detail;
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [backdropBroken, setBackdropBroken] = useState(false);
  const [posterBroken, setPosterBroken] = useState(false);

  // Dynamic browser-compatible streams resolved during the session (appended to initial sources)
  const [resolvedStreams, setResolvedStreams] = useState<PlaybackSource[]>([]);
  const [activeStreamIndex, setActiveStreamIndex] = useState(0);

  const saved = useWatchlist((s) => s.items.some((item) => item.id === `${title.kind}:${title.slug}`));
  const toggle = useWatchlist((s) => s.toggle);

  const allPlayback: PlaybackSource[] = [...detail.playback, ...resolvedStreams];
  const releases = detail.releases ?? [];

  const handlePlayResolvedStream = (link: ResolvedMirrorLink, labelPrefix?: string) => {
    if (!link.playable || !link.streamType) return;
    const streamSource: PlaybackSource = {
      url: link.url,
      type: link.streamType,
      label: labelPrefix ? `${labelPrefix} · ${link.server}` : link.server,
      note: link.codecNote,
    };

    const existingIdx = allPlayback.findIndex((s) => s.url === streamSource.url);
    if (existingIdx >= 0) {
      setActiveStreamIndex(existingIdx);
    } else {
      const nextIndex = detail.playback.length + resolvedStreams.length;
      setResolvedStreams((prev) => [...prev, streamSource]);
      setActiveStreamIndex(nextIndex);
    }

    setTimeout(() => {
      document.getElementById("play")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

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
                ) : releases.length > 0 ? (
                  <a
                    href="#qualities"
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                  >
                    <HardDrive size={16} aria-hidden="true" /> Qualities &amp; mirrors ({releases.length})
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

                {(allPlayback.length > 0 || releases.length > 0) && title.trailer && (
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
        {(allPlayback.length > 0 || releases.length === 0) && (
          <PlaybackSection
            playback={allPlayback}
            active={activeStreamIndex}
            onSelectActive={setActiveStreamIndex}
            detail={detail}
          />
        )}

        {releases.length > 0 && (
          <ReleasesSection
            releases={releases}
            kind={title.kind}
            officialUrl={title.officialUrl}
            onPlayStream={handlePlayResolvedStream}
          />
        )}

        {title.kind === "series" && seasons.length > 0 && (
          <SeasonsSection slug={title.slug} seasons={seasons} onPlayStream={handlePlayResolvedStream} />
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

      <TrailerSheet open={trailerOpen} onClose={() => setTrailerOpen(false)} trailer={title.trailer} title={title.title} />
    </article>
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
  onModeChange,
  onStreamError,
}: {
  source: PlaybackSource;
  poster?: string;
  onModeChange: (url: string, mode: HlsPlaybackMode) => void;
  onStreamError: (url: string, message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    let disposed = false;
    let teardown: (() => void) | undefined;

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

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [source, onModeChange, onStreamError]);

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
  const downloads = detail.downloads ?? [];

  const handleStreamError = (url: string, reason: string) => {
    setFailedReasons((prev) => (prev[url] === reason ? prev : { ...prev, [url]: reason }));
  };

  const handleModeChange = (url: string, mode: HlsPlaybackMode) => {
    setStreamModes((prev) => (prev[url] === mode ? prev : { ...prev, [url]: mode }));
  };

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
            onModeChange={handleModeChange}
            onStreamError={handleStreamError}
          />
        )}
      </div>

      {failureMessage && (
        <div
          role="alert"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-danger/12 px-3.5 py-2.5 text-[12.5px] text-fg ring-1 ring-danger/30"
        >
          <span>{failureMessage}</span>
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

/* --------------------- qualities & mirror resolution --------------------- */

function ReleasesSection({
  releases,
  kind,
  officialUrl,
  onPlayStream,
}: {
  releases: MediaReleaseItem[];
  kind: "movie" | "series";
  officialUrl?: string | null;
  onPlayStream: (link: ResolvedMirrorLink, labelPrefix?: string) => void;
}) {
  return (
    <section id="qualities" aria-labelledby="qualities-heading">
      <SectionHeader
        title={<span id="qualities-heading">{kind === "series" ? "Season packs & releases" : "Available qualities & mirrors"}</span>}
        subtitle={`${releases.length} ${releases.length === 1 ? "release" : "releases"} · Only verified MP4/WebM/HLS streams open in the in-page player`}
        trailing={
          officialUrl ? (
            <a
              href={officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-fg-2 hover:text-fg"
            >
              Source page <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : undefined
        }
      />
      <div className="space-y-2.5 px-4 desk:px-8">
        {releases.map((rel) => (
          <ReleaseCard key={rel.id} release={rel} onPlayStream={onPlayStream} />
        ))}
      </div>
    </section>
  );
}

function ReleaseCard({
  release,
  compact = false,
  onPlayStream,
}: {
  release: MediaReleaseItem;
  compact?: boolean;
  onPlayStream: (link: ResolvedMirrorLink, labelPrefix?: string) => void;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const [states, setStates] = useState<
    Record<
      string,
      {
        loading: boolean;
        result?: MirrorResolveResult;
        error?: string;
      }
    >
  >({});

  const resolveMirror = async (mirror: MediaMirror) => {
    setStates((prev) => ({
      ...prev,
      [mirror.id]: { loading: true },
    }));

    try {
      const result = await mediaApi.resolveMirror({
        url: mirror.shortUrl,
        fileName: release.fileName,
        label: release.title,
      });
      setStates((prev) => ({
        ...prev,
        [mirror.id]: { loading: false, result },
      }));
    } catch (err) {
      const message = err instanceof MediaApiError ? err.message : "Could not resolve this mirror right now.";
      setStates((prev) => ({
        ...prev,
        [mirror.id]: { loading: false, error: message },
      }));
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await copyText(url);
      pushToast({ title: "Copied direct link to clipboard", kind: "ok" });
    } catch {
      pushToast({ title: "Clipboard unavailable", desc: "Right-click Download / Open to copy the link.", kind: "warn" });
    }
  };

  return (
    <div
      className={cx(
        "rounded-[14px] ring-1 ring-edge",
        compact ? "bg-fill/60 p-3" : "bg-raised/70 p-4"
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {release.quality && (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-on-primary">
            {release.quality}
          </span>
        )}
        {release.container && (
          <span
            className={cx(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase",
              release.container === "MP4" || release.container === "WEBM" || release.container === "M3U8"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-fill-2 text-fg-2"
            )}
          >
            {release.container}
          </span>
        )}
        {release.size && (
          <span className="rounded-full bg-fill px-2.5 py-0.5 text-[11.5px] font-semibold text-fg">
            {release.size}
          </span>
        )}
        {(release.tags ?? []).map((tag) => (
          <span key={tag} className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-medium text-fg-2">
            {tag}
          </span>
        ))}
        {release.languages && <span className="text-[11.5px] text-fg-2">· {release.languages}</span>}
      </div>

      <p className="mt-1.5 text-[13.5px] font-semibold text-fg">{release.title}</p>
      {release.fileName && release.fileName !== release.title && (
        <p className="mt-0.5 break-all text-[12px] text-fg-3">{release.fileName}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {release.mirrors.map((mirror) => {
          const st = states[mirror.id];
          return (
            <button
              key={mirror.id}
              type="button"
              disabled={st?.loading}
              onClick={() => void resolveMirror(mirror)}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg transition-colors hover:bg-fill-3 disabled:opacity-60"
            >
              {st?.loading ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={12} aria-hidden="true" />
              )}
              {st?.loading ? `Resolving ${mirror.label}…` : st?.result ? `Re-resolve ${mirror.label}` : `Resolve ${mirror.label}`}
            </button>
          );
        })}
      </div>

      {/* Per-mirror resolution outputs */}
      {release.mirrors.map((mirror) => {
        const st = states[mirror.id];
        if (!st || st.loading) return null;

        if (st.error) {
          return (
            <div
              key={`${mirror.id}-err`}
              className="mt-3 rounded-[10px] bg-fill p-3 text-[12.5px] text-fg-2 ring-1 ring-edge"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium text-fg">
                  <AlertCircle size={14} className="text-danger" aria-hidden="true" />
                  {mirror.label}: {st.error}
                </span>
                <a
                  href={mirror.shortUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-full bg-fill-2 px-3 py-1 text-[12px] font-semibold text-fg hover:bg-fill-3"
                >
                  Open mirror page <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
            </div>
          );
        }

        const res = st.result;
        if (!res) return null;
        const fallbackHref = res.externalFallbackUrl || mirror.shortUrl;

        return (
          <div key={`${mirror.id}-out`} className="mt-3 space-y-2 rounded-[10px] bg-fill p-3 ring-1 ring-edge">
            {res.message && <p className="text-[12px] leading-relaxed text-fg-2">{res.message}</p>}

            {res.links.length > 0 ? (
              <div className="space-y-2">
                {res.links.map((link) => (
                  <div
                    key={link.url}
                    className="flex flex-col gap-2 rounded-[8px] bg-surface/70 p-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-fg">{link.server}</span>
                        {link.container && (
                          <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-bold text-fg-2">
                            {link.container}
                          </span>
                        )}
                        <span
                          className={cx(
                            "rounded px-1.5 py-0.5 text-[10.5px] font-semibold",
                            link.playable ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                          )}
                        >
                          {link.playable
                            ? link.streamType === "hls"
                              ? "HLS manifest candidate"
                              : `Stream candidate (${link.streamType?.toUpperCase()})`
                            : link.delivery === "external"
                              ? "External page"
                              : "Direct download / External player"}
                        </span>
                      </div>
                      {(link.unsupportedReason || link.codecNote) && (
                        <p className="mt-1 text-[11.5px] leading-relaxed text-fg-3">
                          {link.unsupportedReason || link.codecNote}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {link.playable && (
                        <button
                          type="button"
                          onClick={() => onPlayStream(link, release.quality || release.title)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary hover:opacity-90"
                        >
                          <Play size={12} fill="currentColor" aria-hidden="true" />{" "}
                          {link.streamType === "hls" ? "Load in HLS player" : "Play in player"}
                        </button>
                      )}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                      >
                        {link.delivery === "external" ? (
                          <>
                            Open <ExternalLink size={12} aria-hidden="true" />
                          </>
                        ) : (
                          <>
                            <Download size={12} aria-hidden="true" /> Download
                          </>
                        )}
                      </a>
                      {link.delivery !== "external" && (
                        <button
                          type="button"
                          onClick={() => void handleCopy(link.url)}
                          aria-label={`Copy direct URL from ${link.server}`}
                          title="Copy direct stream/download URL for VLC / MPV / IINA"
                          className="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-2.5 text-[12px] font-semibold text-fg-2 hover:bg-fill-3 hover:text-fg"
                        >
                          <Copy size={12} aria-hidden="true" /> Copy URL
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-2">
                <span>
                  Automatic extraction stopped ({res.reason || res.status}). You can open the validated upstream link directly.
                </span>
                <a
                  href={fallbackHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 rounded-full bg-fill-2 px-3 py-1.5 font-semibold text-fg hover:bg-fill-3"
                >
                  Open {mirror.label} <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- seasons -------------------------------- */

function SeasonsSection({
  slug,
  seasons,
  onPlayStream,
}: {
  slug: string;
  seasons: Season[];
  onPlayStream: (link: ResolvedMirrorLink, labelPrefix?: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(seasons[0]?.seasonNumber ?? null);
  return (
    <section className="mb-9" aria-labelledby="seasons-heading">
      <SectionHeader
        title={<span id="seasons-heading">Seasons &amp; episodes</span>}
        subtitle={`${seasons.length} season${seasons.length === 1 ? "" : "s"}`}
      />
      <div className="space-y-2 px-4 desk:px-8">
        {seasons.map((season) => (
          <SeasonRow
            key={season.id}
            slug={slug}
            season={season}
            open={open === season.seasonNumber}
            onToggle={() => setOpen((current) => (current === season.seasonNumber ? null : season.seasonNumber))}
            onPlayStream={onPlayStream}
          />
        ))}
      </div>
    </section>
  );
}

function SeasonRow({
  slug,
  season,
  open,
  onToggle,
  onPlayStream,
}: {
  slug: string;
  season: Season;
  open: boolean;
  onToggle: () => void;
  onPlayStream: (link: ResolvedMirrorLink, labelPrefix?: string) => void;
}) {
  const [openEpisodeId, setOpenEpisodeId] = useState<string | null>(null);
  const needsFetch = open && season.episodes.length === 0;
  const { data, isLoading, isError } = useSeasonEpisodes(slug, season.seasonNumber, needsFetch);
  const episodes: Episode[] = season.episodes.length > 0 ? season.episodes : (data?.seasons[0]?.episodes ?? []);
  const overview = season.overview ?? data?.seasons[0]?.overview;

  return (
    <div className="overflow-hidden rounded-[12px] bg-raised/70 ring-1 ring-edge">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-fill"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-fill text-[12px] font-bold text-fg-2">
          {season.seasonNumber}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{season.name}</span>
          <span className="block text-[12.5px] text-fg-2">
            {season.episodes.length > 0 ? `${season.episodes.length} episodes` : "Episodes on demand"}
            {season.airDate ? ` · ${season.airDate.slice(0, 4)}` : ""}
          </span>
        </span>
        <ChevronDown size={17} className={cx("shrink-0 text-fg-2 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="hairline-t px-4 pt-3 pb-4">
          {overview && <p className="mb-3 text-[13px] leading-relaxed text-fg-2">{overview}</p>}
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[52px] w-full animate-pulse rounded-[8px] bg-fill" />
              ))}
            </div>
          ) : isError ? (
            <p className="py-2 text-[13px] text-fg-2">Episodes couldn&apos;t be loaded right now.</p>
          ) : episodes.length === 0 ? (
            <p className="py-2 text-[13px] text-fg-2">No episode metadata for this season.</p>
          ) : (
            <ol className="space-y-1.5" aria-label={`${season.name} episodes`}>
              {episodes.map((episode) => {
                const epReleases = episode.releases ?? [];
                const isEpExpanded = openEpisodeId === episode.id;

                return (
                  <li key={episode.id} className="rounded-[10px] bg-fill/40 px-2.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 gap-3">
                        <span className="w-5 shrink-0 pt-0.5 text-right text-[12.5px] font-semibold text-fg-3 tabular-nums">
                          {episode.episodeNumber}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-[14px] font-medium">{episode.title}</span>
                            {episode.size && <span className="text-[11.5px] text-fg-2">{episode.size}</span>}
                            {episode.runtimeMinutes ? (
                              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                                <Clock size={11} aria-hidden="true" /> {episode.runtimeMinutes} min
                              </span>
                            ) : null}
                            {episode.airDate ? (
                              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                                <Calendar size={11} aria-hidden="true" /> {episode.airDate.slice(0, 10)}
                              </span>
                            ) : null}
                            {episode.rating ? (
                              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                                <Star size={10} fill="currentColor" aria-hidden="true" /> {episode.rating.toFixed(1)}
                              </span>
                            ) : null}
                          </div>
                          {episode.overview && (
                            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{episode.overview}</p>
                          )}
                        </div>
                      </div>

                      {epReleases.length > 0 && (
                        <button
                          type="button"
                          aria-expanded={isEpExpanded}
                          onClick={() => setOpenEpisodeId(isEpExpanded ? null : episode.id)}
                          className="rounded-full bg-fill-2 px-3 py-1 text-[12px] font-semibold text-fg hover:bg-fill-3"
                        >
                          {isEpExpanded
                            ? "Hide mirrors"
                            : `${epReleases.length} ${epReleases.length === 1 ? "quality" : "qualities"}`}
                        </button>
                      )}
                    </div>

                    {isEpExpanded && epReleases.length > 0 && (
                      <div className="mt-2.5 space-y-2 pl-8">
                        {epReleases.map((rel) => (
                          <ReleaseCard
                            key={rel.id}
                            release={rel}
                            compact
                            onPlayStream={(link) =>
                              onPlayStream(
                                link,
                                `S${String(episode.seasonNumber).padStart(2, "0")}E${String(episode.episodeNumber).padStart(2, "0")} ${rel.quality || ""}`.trim()
                              )
                            }
                          />
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
