"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { Bookmark, Play, Star } from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import type { MediaTitle } from "@/lib/media/types";
import { useWatchlist } from "@/store/watchlist";
import { cx } from "@/lib/format";
import { ExclusiveBadge } from "@/components/media/ExclusiveBadge";
import { mediaHref } from "@/components/media/PosterCard";

/** "2160p" → "4K", "1080p" → "HD" — short enough for a poster corner. */
export function qualityBadge(quality?: string | null): string | null {
  if (!quality) return null;
  const value = quality.trim().toLowerCase();
  if (value.startsWith("2160") || value.includes("4k")) return "4K";
  if (value.startsWith("1440")) return "2K";
  if (value.startsWith("1080")) return "HD";
  if (value.startsWith("720")) return "HD";
  if (value.startsWith("480") || value.startsWith("360")) return "SD";
  return quality.length <= 4 ? quality.toUpperCase() : null;
}

/**
 * A poster for the exclusive collection.
 *
 * Independent of `PosterCard`: this one carries a rank numeral (Top 10 rails),
 * the advertised quality, a play affordance that opens the Shaka player in
 * place, and the rating in a stronger treatment — the four things a
 * browse-first film site needs on a card.
 */
export const ExclusivePoster = memo(function ExclusivePoster({
  title,
  rank,
  eager,
  className,
  onPlay,
}: {
  title: MediaTitle;
  /** 1-based rank; renders the numeral beside the artwork. */
  rank?: number;
  eager?: boolean;
  className?: string;
  onPlay?: (title: MediaTitle) => void;
}) {
  const [broken, setBroken] = useState(false);
  const watchKey = `${title.kind}:${title.slug}`;
  const saved = useWatchlist((s) => Boolean(s.savedMap[watchKey]));
  const toggle = useWatchlist((s) => s.toggle);

  const artwork = mediaArt(broken ? null : title.poster, { seed: title.slug, accent: title.accent });
  const quality = qualityBadge(title.quality);
  const meta = [title.year, title.genres[0]?.name].filter(Boolean).join(" · ");

  return (
    <article className={cx("group/exp relative shrink-0 snap-start", className)}>
      {rank !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-1 bottom-0 z-10 select-none text-[44px] leading-none font-black tracking-[-0.09em] text-white/85 tabular-nums [text-shadow:0_2px_14px_rgba(0,0,0,0.75)] desk:text-[54px]"
        >
          {rank}
        </span>
      )}

      <Link href={mediaHref(title)} className="block rounded-[12px] focus-visible:outline-none">
        <div className="relative aspect-[2/3] overflow-hidden rounded-[12px] bg-raised ring-1 ring-edge transition-shadow duration-300 group-hover/exp:shadow-[0_18px_44px_-18px_rgba(0,0,0,0.85)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artwork}
            alt={`${title.title} poster`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover/exp:scale-[1.05]"
          />

          {/* Bottom scrim keeps the badges readable on bright artwork. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
          />

          {typeof title.rating === "number" && title.rating > 0 && (
            <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-[3px] text-[11px] font-bold text-white backdrop-blur-md">
              <Star size={11} fill="#f7c948" stroke="#f7c948" aria-hidden="true" />
              {title.rating.toFixed(1)}
              <span className="sr-only">out of 10</span>
            </span>
          )}

          {quality && (
            <span className="absolute top-2 right-2 rounded-[5px] bg-white/92 px-1.5 py-[2px] text-[9.5px] font-black tracking-[0.04em] text-black uppercase">
              {quality}
            </span>
          )}

          <ExclusiveBadge className="absolute bottom-2 left-2" compact />

          {onPlay && (
            <button
              type="button"
              aria-label={`Play ${title.title}`}
              onClick={() => onPlay(title)}
              className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover/exp:opacity-100 focus-visible:opacity-100"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/95 text-black shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] transition-transform active:scale-95">
                <Play size={20} fill="currentColor" aria-hidden="true" />
              </span>
            </button>
          )}
        </div>

        <div className="mt-2 min-w-0">
          <div className="truncate text-[14px] leading-snug font-semibold">{title.title}</div>
          {meta && <div className="truncate text-[12.5px] leading-snug text-fg-2">{meta}</div>}
        </div>
      </Link>

      <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${title.title} from watchlist` : `Add ${title.title} to watchlist`}
        onClick={() => toggle(title)}
        className={cx(
          "absolute top-2 right-2 z-10 grid h-8 w-8 place-items-center rounded-full opacity-0 backdrop-blur-md transition-[background,color,opacity] duration-150 group-hover/exp:opacity-100 focus-visible:opacity-100 active:scale-90",
          saved ? "bg-primary text-on-primary" : "bg-black/60 text-white hover:bg-black/80",
          quality ? "top-9" : ""
        )}
      >
        <Bookmark size={14} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </article>
  );
});

/** Fixed card width so shelves line up. */
export const exclusiveShelfClass = "w-[132px] sm:w-[148px] desk:w-[160px]";
