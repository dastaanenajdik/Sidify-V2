"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Info, Play, Star } from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import { mediaHref } from "./PosterCard";
import { TrailerSheet } from "./TrailerSheet";
import type { MediaTitle } from "@/lib/media/types";
import { useWatchlist } from "@/store/watchlist";
import { cx } from "@/lib/format";

/**
 * The featured title at the top of /movies and /series: full-bleed backdrop, a scrim
 * that fades into the page colour, and the same round buttons the music pages use.
 */
export function MediaHero({ title }: { title: MediaTitle }) {
  const [trailerOpen, setTrailerOpen] = useState(false);
  const saved = useWatchlist((s) => s.items.some((item) => item.id === `${title.kind}:${title.slug}`));
  const toggle = useWatchlist((s) => s.toggle);

  const backdrop = mediaArt(title.backdrop ?? title.poster, { seed: title.slug, accent: title.accent, ratio: "backdrop" });
  const meta = [
    title.year,
    title.runtimeMinutes ? (title.kind === "movie" ? `${title.runtimeMinutes} min` : `${title.runtimeMinutes} min episodes`) : "",
    title.seasonCount ? `${title.seasonCount} season${title.seasonCount === 1 ? "" : "s"}` : "",
    title.genres.slice(0, 2).map((g) => g.name).join(", "),
    title.certification,
  ].filter(Boolean);

  return (
    <header className="relative isolate overflow-hidden">
      <div className="relative h-[430px] w-full desk:h-[470px]">
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
              "linear-gradient(90deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.5) 42%, rgba(0,0,0,0.16) 72%, rgba(0,0,0,0.05) 100%), linear-gradient(180deg, rgba(0,0,0,0.06) 0%, rgba(0,0,0,0.22) 42%, rgba(0,0,0,0.72) 78%, var(--bg) 100%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-end px-5 pb-7 desk:px-8 desk:pb-9">
          <div className="max-w-[640px] text-white">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="t-eyebrow rounded-full bg-white/15 px-2.5 py-1 text-white/90 backdrop-blur-md">
                Featured {title.kind === "movie" ? "film" : "series"}
              </span>
              {typeof title.rating === "number" && title.rating > 0 && (
                <span className="flex items-center gap-1 text-[12px] font-semibold text-white/85">
                  <Star size={12} fill="currentColor" aria-hidden="true" />
                  {title.rating.toFixed(1)}
                  <span className="sr-only">out of 10</span>
                </span>
              )}
              {title.demo && (
                <span className="rounded-full bg-white/12 px-2 py-[3px] text-[10px] font-bold tracking-[0.06em] text-white/75 uppercase">
                  Demo title
                </span>
              )}
            </div>

            <h2 className="line-clamp-2 text-[32px] leading-[1.05] font-extrabold tracking-[-0.8px] desk:text-[46px] desk:tracking-[-1.2px]">
              {title.title}
            </h2>
            {meta.length > 0 && (
              <p className="mt-2 text-[12.5px] font-semibold tracking-[0.04em] text-white/65 uppercase">{meta.join(" · ")}</p>
            )}
            <p className="mt-3 line-clamp-3 max-w-[560px] text-[14px] leading-relaxed text-white/80 desk:text-[15px]">
              {title.overview}
            </p>

            <div className="mt-5 flex items-center gap-2.5">
              <Link
                href={mediaHref(title)}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-black transition-transform active:scale-[0.97] hover:opacity-90"
              >
                <Info size={16} aria-hidden="true" /> More info
              </Link>
              {title.trailer && (
                <button
                  type="button"
                  onClick={() => setTrailerOpen(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-white/16 px-5 text-[15px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-xl transition-colors hover:bg-white/24"
                >
                  <Play size={15} fill="currentColor" aria-hidden="true" /> Trailer
                </button>
              )}
              <button
                type="button"
                aria-pressed={saved}
                aria-label={saved ? `Remove ${title.title} from watchlist` : `Add ${title.title} to watchlist`}
                title={saved ? "In your watchlist" : "Add to watchlist"}
                onClick={() => toggle(title)}
                className={cx(
                  "grid h-11 w-11 place-items-center rounded-full backdrop-blur-xl transition-colors",
                  saved ? "bg-white text-black" : "bg-white/16 text-white ring-1 ring-white/20 hover:bg-white/24"
                )}
              >
                {saved ? <Check size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <TrailerSheet open={trailerOpen} onClose={() => setTrailerOpen(false)} trailer={title.trailer} title={title.title} />
    </header>
  );
}
