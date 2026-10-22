"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Play,
  Star,
} from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import { useSeasonEpisodes } from "@/lib/media/hooks";
import type { Episode, MediaDetail, PlaybackSource, Season } from "@/lib/media/types";
import { SectionHeader, Shelf } from "@/components/ui";
import { useWatchlist } from "@/store/watchlist";
import { cx } from "@/lib/format";
import { PosterCard, posterShelfClass } from "./PosterCard";
import { TrailerSheet } from "./TrailerSheet";

/** Everything on a /movies/[slug] or /series/[slug] page. */
export default function MediaDetailView({ detail }: { detail: MediaDetail }) {
  const { title, seasons, related, playback } = detail;
  const [trailerOpen, setTrailerOpen] = useState(false);
  const saved = useWatchlist((s) => s.items.some((item) => item.id === `${title.kind}:${title.slug}`));
  const toggle = useWatchlist((s) => s.toggle);

  const backdrop = mediaArt(title.backdrop ?? title.poster, { seed: title.slug, accent: title.accent, ratio: "backdrop" });
  const poster = mediaArt(title.poster, { seed: title.slug, accent: title.accent });
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
              <img src={poster} alt={`${title.title} poster`} decoding="async" className="aspect-[2/3] w-full object-cover" />
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
                {playback.length > 0 ? (
                  <a
                    href="#play"
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
                  >
                    <Play size={16} fill="currentColor" aria-hidden="true" /> Play
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

                {playback.length > 0 && title.trailer && (
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16" style={{ background: "linear-gradient(180deg, transparent, var(--bg))" }} aria-hidden="true" />
      </header>

      <div className="mt-6">
        <PlaybackSection playback={playback} detail={detail} />
      </div>

      {title.kind === "series" && seasons.length > 0 && <SeasonsSection slug={title.slug} seasons={seasons} />}

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

      <div className="px-4 pb-4 desk:px-8">
        <Link href={title.kind === "movie" ? "/movies" : "/series"} className="inline-flex items-center gap-1 text-[13px] font-semibold text-playing hover:opacity-80">
          ← Back to all {title.kind === "movie" ? "movies" : "series"}
        </Link>
        {detail.attribution && <p className="mt-4 max-w-[640px] text-[11.5px] leading-relaxed text-fg-3">{detail.attribution}</p>}
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

/**
 * Authorized playback only.
 *
 * URLs come from the operator's manifest or a licensed provider — never from a
 * scraper. With none configured we say so plainly and point at the official trailer /
 * availability links instead of inventing a stream.
 */
function PlaybackSection({ playback, detail }: { playback: PlaybackSource[]; detail: MediaDetail }) {
  const { title } = detail;
  const [active, setActive] = useState(0);

  if (playback.length === 0) {
    const links = title.watchProviders ?? [];
    return (
      <section aria-labelledby="where-to-watch" className="px-4 desk:px-8">
        <div className="rounded-[16px] bg-raised/70 p-4 ring-1 ring-edge desk:p-5">
          <h2 id="where-to-watch" className="t-title">
            Where to watch
          </h2>
          <p className="mt-1.5 max-w-[680px] text-[13.5px] leading-relaxed text-fg-2">
            No authorized playback source is configured for this title, so there is no in-site player.{" "}
            {links.length > 0
              ? "Use the availability options below to find licensed streaming, rental or purchase services."
              : "No official availability information is available for this title."}
          </p>
          {!title.trailer && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
              Official trailers appear here when the catalogue provider supplies one.
            </p>
          )}
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
              {links.some((link) => link.name === "Search JustWatch") && (
                <p className="mt-2 text-[11.5px] text-fg-3">Availability varies by country and can change over time.</p>
              )}
            </>
          )}
          {title.officialUrl && (
            <a
              href={title.officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-playing hover:opacity-80"
            >
              Official page <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </section>
    );
  }

  const source = playback[Math.min(active, playback.length - 1)];
  return (
    <section id="play" aria-labelledby="authorized-playback" className="px-4 desk:px-8">
      <div className="overflow-hidden rounded-[16px] bg-black ring-1 ring-edge">
        <video
          controls
          playsInline
          preload="metadata"
          poster={title.backdrop ?? title.poster ?? undefined}
          className="aspect-video w-full bg-black"
        >
          <source src={source.url} type={source.type === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4"} />
          Your browser can&apos;t play this authorized stream.
        </video>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h2 id="authorized-playback" className="text-[13px] font-semibold text-fg-2">
          Authorized playback
        </h2>
        {playback.map((item, index) => (
          <button
            key={item.url}
            type="button"
            onClick={() => setActive(index)}
            aria-pressed={index === active}
            className={cx(
              "rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors",
              index === active ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
            )}
          >
            {item.label ?? (item.type === "hls" ? "HLS" : "MP4")}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
        HLS plays natively in Safari and on iOS/iPadOS; other browsers need an MP4 rendition from the same licensed source.
      </p>
    </section>
  );
}

/* -------------------------------- seasons -------------------------------- */

function SeasonsSection({ slug, seasons }: { slug: string; seasons: Season[] }) {
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
}: {
  slug: string;
  season: Season;
  open: boolean;
  onToggle: () => void;
}) {
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
            <ol className="space-y-0.5" aria-label={`${season.name} episodes`}>
              {episodes.map((episode) => (
                <li key={episode.id}>
                  <div className="flex gap-3 rounded-[8px] px-1 py-2.5 transition-colors hover:bg-fill/60">
                    <span className="w-5 shrink-0 pt-0.5 text-right text-[12.5px] font-semibold text-fg-3 tabular-nums">
                      {episode.episodeNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[14px] font-medium">{episode.title}</span>
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
                      {episode.overview && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{episode.overview}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
