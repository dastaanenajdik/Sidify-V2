"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Info, Play, Shuffle, Sparkles, Star } from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import type { MediaTitle } from "@/lib/media/types";
import { cx } from "@/lib/format";
import { mediaHref } from "@/components/media/PosterCard";
import { qualityBadge } from "./ExclusivePoster";

function runtimeLabel(title: MediaTitle): string | null {
  if (title.kind === "series") {
    if (title.seasonCount) return `${title.seasonCount} season${title.seasonCount === 1 ? "" : "s"}`;
    return null;
  }
  if (!title.runtimeMinutes) return null;
  const hours = Math.floor(title.runtimeMinutes / 60);
  const minutes = title.runtimeMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * The spotlight at the top of the exclusive collection.
 *
 * One title, given the whole stage: artwork behind a scrim, the title, its
 * rating and facts, a short synopsis, and the three actions that matter —
 * play, open the detail page, or save for later. A "Surprise me" button picks
 * another title from the same collection.
 */
export function ExclusiveHero({
  title,
  onPlay,
  onSurprise,
  saved,
  onToggleSave,
}: {
  title: MediaTitle;
  onPlay: (title: MediaTitle) => void;
  onSurprise?: () => void;
  saved: boolean;
  onToggleSave: (title: MediaTitle) => void;
}) {
  const [broken, setBroken] = useState(false);
  const backdrop = mediaArt(broken ? null : title.backdrop ?? title.poster, {
    seed: title.slug,
    accent: title.accent,
    ratio: "backdrop",
  });
  const quality = qualityBadge(title.quality);
  const runtime = runtimeLabel(title);
  const cast = title.cast?.slice(0, 3).join(", ");

  return (
    <header className="relative isolate overflow-hidden text-white">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backdrop}
        alt=""
        aria-hidden="true"
        decoding="async"
        draggable={false}
        onError={() => setBroken(true)}
        className="absolute inset-0 h-full w-full object-cover object-top"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.72) 42%, rgba(0,0,0,0.25) 100%), linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.35) 45%, var(--bg) 100%)",
        }}
      />

      <div className="relative flex min-h-[440px] flex-col justify-end px-4 pt-16 pb-7 desk:min-h-[540px] desk:px-8 desk:pb-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/14 px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] uppercase backdrop-blur-md">
            <Sparkles size={12} aria-hidden="true" />
            Exclusive collection
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/75 backdrop-blur-md">
            Featured tonight
          </span>
          {quality && (
            <span className="rounded-[5px] bg-white/90 px-1.5 py-[3px] text-[10px] font-black tracking-[0.04em] text-black uppercase">
              {quality}
            </span>
          )}
        </div>

        <h1 className="mt-3 max-w-[820px] text-[34px] leading-[1.02] font-black tracking-[-1px] desk:text-[60px] desk:tracking-[-2px]">
          {title.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] font-semibold text-white/80">
          {typeof title.rating === "number" && title.rating > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Star size={13} fill="#f7c948" stroke="#f7c948" aria-hidden="true" />
              <span className="text-white">{title.rating.toFixed(1)}</span>
              <span className="text-white/50">/ 10</span>
              {title.votes ? <span className="text-white/45">({formatVotes(title.votes)})</span> : null}
            </span>
          )}
          {title.year && <span>{title.year}</span>}
          {runtime && <span>{runtime}</span>}
          {title.certification && (
            <span className="rounded-[3px] bg-white/15 px-1.5 py-[1px] text-[10.5px] font-bold tracking-[0.04em]">
              {title.certification}
            </span>
          )}
          <span className="uppercase">{title.languageName ?? title.language.toUpperCase()}</span>
          {title.kind === "series" && title.episodeCount ? <span>{title.episodeCount} episodes</span> : null}
        </div>

        {title.genres.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {title.genres.slice(0, 5).map((genre) => (
              <span key={genre.id} className="rounded-full bg-white/10 px-2 py-[3px] text-[11px] font-medium text-white/80">
                {genre.name}
              </span>
            ))}
          </div>
        )}

        {title.overview && (
          <p className="mt-3 line-clamp-3 max-w-[660px] text-[13.5px] leading-relaxed text-white/80 desk:text-[15px]">
            {title.overview}
          </p>
        )}

        {cast && (
          <p className="mt-2 max-w-[660px] truncate text-[12.5px] text-white/60">
            <span className="font-semibold text-white/75">Cast:</span> {cast}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onPlay(title)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-bold text-black transition-transform active:scale-[0.97] hover:opacity-90"
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
            Play now
          </button>

          <Link
            href={mediaHref(title)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white/14 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition-colors hover:bg-white/22"
          >
            <Info size={16} aria-hidden="true" />
            More info
          </Link>

          <button
            type="button"
            aria-pressed={saved}
            onClick={() => onToggleSave(title)}
            className={cx(
              "inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold backdrop-blur-xl transition-colors",
              saved ? "bg-white text-black" : "bg-white/14 text-white ring-1 ring-white/20 hover:bg-white/22"
            )}
          >
            {saved ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
            {saved ? "In watchlist" : "Watchlist"}
          </button>

          {onSurprise && (
            <button
              type="button"
              onClick={onSurprise}
              title="Play something else from the collection"
              className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Shuffle size={15} aria-hidden="true" />
              Surprise me
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function formatVotes(votes: number): string {
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}K`;
  return String(Math.round(votes));
}
