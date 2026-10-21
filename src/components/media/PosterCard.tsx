"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, Star } from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import type { MediaTitle } from "@/lib/media/types";
import { useWatchlist } from "@/store/watchlist";
import { cx } from "@/lib/format";

const KIND_PATH = { movie: "movies", series: "series" } as const;

export function mediaHref(title: Pick<MediaTitle, "kind" | "slug">): string {
  return `/${KIND_PATH[title.kind]}/${encodeURIComponent(title.slug)}`;
}

/**
 * A 2:3 poster card: artwork, rating, title and year · genre, plus a watchlist toggle.
 * Missing artwork is drawn locally rather than fetched from a placeholder service.
 */
export function PosterCard({ title, className, eager }: { title: MediaTitle; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState(false);
  const saved = useWatchlist((s) => s.items.some((item) => item.id === `${title.kind}:${title.slug}`));
  const toggle = useWatchlist((s) => s.toggle);

  const artwork = broken ? mediaArt(null, { seed: title.slug, accent: title.accent }) : mediaArt(title.poster, { seed: title.slug, accent: title.accent });
  const meta = [title.year, title.genres[0]?.name].filter(Boolean).join(" · ");

  return (
    <article className={cx("group/poster relative shrink-0 snap-start", className)}>
      <Link href={mediaHref(title)} className="block rounded-[10px]">
        <div className="relative aspect-[2/3] overflow-hidden rounded-[10px] bg-raised ring-1 ring-edge">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artwork}
            alt={`${title.title} poster`}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover/poster:scale-[1.04]"
          />
          {typeof title.rating === "number" && title.rating > 0 && (
            <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/65 px-2 py-[3px] text-[11px] font-semibold text-white backdrop-blur-md">
              <Star size={11} fill="currentColor" aria-hidden="true" />
              {title.rating.toFixed(1)}
              <span className="sr-only">out of 10</span>
            </span>
          )}
          {title.demo && (
            <span className="absolute bottom-2 left-2 rounded-full bg-white/15 px-1.5 py-[2px] text-[9px] font-bold tracking-[0.06em] text-white/90 uppercase backdrop-blur-md">
              Demo
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0">
          <div className="truncate text-[14px] leading-snug font-medium">{title.title}</div>
          {meta && <div className="truncate text-[12.5px] leading-snug text-fg-2">{meta}</div>}
        </div>
      </Link>

      <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${title.title} from watchlist` : `Add ${title.title} to watchlist`}
        title={saved ? "In your watchlist" : "Add to watchlist"}
        onClick={() => toggle(title)}
        className={cx(
          "absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full backdrop-blur-md transition-[background,color,opacity] duration-150 active:scale-90",
          saved ? "bg-primary text-on-primary" : "bg-black/55 text-white hover:bg-black/75"
        )}
      >
        <Bookmark size={15} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </article>
  );
}

/** Fixed width so cards line up inside the horizontal shelves. */
export const posterShelfClass = "w-[132px] sm:w-[146px] desk:w-[156px]";
