"use client";

import Link from "next/link";
import { useState } from "react";
import { Film, Star, Tv } from "lucide-react";
import { mediaArt } from "@/lib/media/art";
import type { MediaTitle } from "@/lib/media/types";
import { Skeleton } from "@/components/ui";
import { mediaHref } from "./PosterCard";

function Row({ item }: { item: MediaTitle }) {
  const [broken, setBroken] = useState(false);
  const art = broken ? mediaArt(null, { seed: item.slug, accent: item.accent }) : mediaArt(item.poster, { seed: item.slug, accent: item.accent });
  const KindIcon = item.kind === "series" ? Tv : Film;
  return (
    <li>
      <Link
        href={mediaHref(item)}
        className="flex items-center gap-3 rounded-[12px] px-2 py-1.5 transition-colors hover:bg-fill"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="aspect-[2/3] w-11 shrink-0 rounded-[6px] bg-raised object-cover ring-1 ring-edge"
        />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[14px] leading-snug font-medium">{item.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-2">
            <KindIcon size={12} aria-hidden="true" />
            {item.kind === "series" ? "Series" : "Movie"}
            {item.year ? ` · ${item.year}` : ""}
            {typeof item.rating === "number" && item.rating > 0 && (
              <span className="inline-flex items-center gap-0.5">
                · <Star size={10} fill="currentColor" aria-hidden="true" /> {item.rating.toFixed(1)}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Compact "Movies & series" results for the side column of the music search page.
 */
export function MediaSearchList({
  items,
  loading,
  onSeeAll,
  limit = 8,
}: {
  items: MediaTitle[];
  loading: boolean;
  onSeeAll?: () => void;
  limit?: number;
}) {
  return (
    <section aria-labelledby="media-side-heading" className="rounded-[18px] bg-raised/60 p-3 ring-1 ring-edge">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 id="media-side-heading" className="text-[15px] font-bold tracking-[-0.2px]">
          Movies &amp; series
        </h2>
        {onSeeAll && items.length > 0 && (
          <button type="button" onClick={onSeeAll} className="text-[13px] font-semibold text-playing hover:opacity-80">
            See all
          </button>
        )}
      </div>
      {loading ? (
        <ul className="space-y-1.5" aria-label="Loading movies and series">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-1.5">
              <Skeleton className="aspect-[2/3] w-11 shrink-0 rounded-[6px]" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/3 rounded" />
              </span>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-fg-2">No movies or series match this search.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, limit).map((item) => (
            <Row key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
