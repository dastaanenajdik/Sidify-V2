"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MoreHorizontal, Play } from "lucide-react";
import type { Album, Artist, Track } from "@/lib/types";
import { playContext } from "@/lib/audioEngine";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";
import { Artwork } from "./ui";
import { PlayingBars } from "./icons";

/* -------------------------------------------------------------------------- */
/*  Square cards (albums, playlists, mixes, single tracks)                     */
/* -------------------------------------------------------------------------- */

const CARD_W = "w-[148px] desk:w-[168px]";

export function SquareCard({
  href,
  onClick,
  onPlay,
  artwork,
  arts,
  title,
  subtitle,
  className,
  round,
  badge,
}: {
  href?: string;
  onClick?: () => void;
  onPlay?: () => void;
  artwork?: string;
  /** Up to four covers for a playlist mosaic. */
  arts?: string[];
  title: string;
  subtitle?: ReactNode;
  className?: string;
  round?: boolean;
  badge?: ReactNode;
}) {
  const cover = (
    <div className="relative">
      {arts && arts.length >= 4 ? (
        <div className="grid aspect-square w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[12px] ring-1 ring-edge">
          {arts.slice(0, 4).map((a, i) => (
            <Artwork key={i} src={a} size={90} rounded="rounded-none" className="h-full w-full" />
          ))}
        </div>
      ) : (
        <Artwork
          src={artwork || arts?.[0]}
          size={180}
          round={round}
          rounded="rounded-[12px]"
          className={cx("aspect-square w-full ring-1 ring-edge", round && "ring-0")}
        />
      )}
      {badge && <div className="absolute top-2 left-2">{badge}</div>}
      {onPlay && !round && (
        <button
          type="button"
          aria-label={`Play ${title}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPlay();
          }}
          className="absolute right-2 bottom-2 grid h-9 w-9 translate-y-1 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-md transition-[opacity,transform] duration-200 group-hover/card:translate-y-0 group-hover/card:opacity-100 hover:scale-105"
        >
          <Play size={16} fill="currentColor" className="ml-0.5" />
        </button>
      )}
    </div>
  );
  const text = (
    <div className={cx("mt-2 min-w-0", round && "text-center")}>
      <div className="truncate text-[14px] leading-snug font-medium">{title}</div>
      {subtitle && <div className="truncate text-[13px] leading-snug text-fg-2">{subtitle}</div>}
    </div>
  );
  const cls = cx("group/card block shrink-0 snap-start text-left", CARD_W, className);
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {cover}
        {text}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={onClick}>
      {cover}
      {text}
    </button>
  );
}

export function AlbumCard({ album, className }: { album: Album; className?: string }) {
  return (
    <SquareCard
      href={`/album/${encodeURIComponent(album.id)}`}
      artwork={album.artwork}
      title={album.title}
      subtitle={album.artist}
      className={className}
    />
  );
}

export function ArtistCard({ artist, className }: { artist: Artist; className?: string }) {
  return (
    <Link href={`/artist/${encodeURIComponent(artist.id)}`} className={cx("group/card block shrink-0 snap-start text-center", CARD_W, className)}>
      <Artwork src={artist.artwork} size={180} round className="aspect-square w-full transition-transform duration-300 group-hover/card:scale-[1.02]" />
      <div className="mt-2 truncate text-[14px] font-medium">{artist.name}</div>
      <div className="text-[12px] text-fg-2">Artist</div>
    </Link>
  );
}

/** A single song as a card: tapping plays it within its shelf. */
export function SongCard({ tracks, index, label, className }: { tracks: Track[]; index: number; label: string; className?: string }) {
  const t = tracks[index];
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === t.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  return (
    <div
      className={cx("group/card relative block shrink-0 snap-start text-left", CARD_W, className)}
      onContextMenu={(e) => {
        e.preventDefault();
        useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY });
      }}
    >
      <button type="button" className="block w-full text-left" onClick={() => playContext(tracks, index, label)}>
        <div className="relative">
          <Artwork src={t.artwork} size={180} rounded="rounded-[12px]" className="aspect-square w-full ring-1 ring-edge" />
          {isCurrent && (
            <span className="absolute right-2 bottom-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-playing backdrop-blur-md">
              <PlayingBars paused={!isPlaying} size={12} />
            </span>
          )}
        </div>
        <div className="mt-2 min-w-0">
          <div className={cx("truncate text-[14px] leading-snug font-medium", isCurrent && "text-playing")}>{t.title}</div>
          <div className="truncate text-[13px] leading-snug text-fg-2">{t.artist}</div>
        </div>
      </button>
      <button
        type="button"
        aria-label="More"
        onClick={(e) => useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY })}
        className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-md transition-opacity group-hover/card:opacity-100"
      >
        <MoreHorizontal size={15} />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hero card                                                                  */
/* -------------------------------------------------------------------------- */

export function HeroCard({
  artwork,
  eyebrow,
  title,
  subtitle,
  onClick,
  href,
  className,
}: {
  artwork?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <Artwork src={artwork} size={360} rounded="rounded-none" eager className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover/hero:scale-[1.03]" />
      <div className="scrim-b absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        {eyebrow && <div className="t-eyebrow mb-1 text-white/70">{eyebrow}</div>}
        <div className="line-clamp-2 text-[20px] leading-tight font-bold tracking-[-0.3px] text-white">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[13px] text-white/70">{subtitle}</div>}
      </div>
    </>
  );
  const cls = cx(
    "group/hero relative block aspect-[0.92] w-[min(70vw,320px)] shrink-0 snap-start overflow-hidden rounded-[18px] bg-raised text-left ring-1 ring-edge desk:w-[300px]",
    className
  );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Compact rows (quick picks, recents) — laid out in columns of four          */
/* -------------------------------------------------------------------------- */

export function CompactRow({ tracks, index, label }: { tracks: Track[]; index: number; label: string }) {
  const t = tracks[index];
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === t.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  return (
    <div
      className="group/row flex h-[60px] items-center gap-3 rounded-[8px] pr-1 transition-colors hover:bg-fill"
      onContextMenu={(e) => {
        e.preventDefault();
        useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY });
      }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => playContext(tracks, index, label)}>
        <span className="relative shrink-0">
          <Artwork src={t.artwork} size={48} className="h-12 w-12" />
          {isCurrent && (
            <span className="absolute inset-0 grid place-items-center rounded-[7px] bg-black/45 text-white">
              <PlayingBars paused={!isPlaying} size={12} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[15px] leading-snug", isCurrent && "text-playing")}>{t.title}</span>
          <span className="block truncate text-[13px] leading-snug text-fg-2">{t.artist}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label="More"
        onClick={(e) => useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY })}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
      >
        <MoreHorizontal size={17} />
      </button>
    </div>
  );
}

/** Columns of four compact rows that scroll sideways together. */
export function QuickPicks({ tracks, label }: { tracks: Track[]; label: string }) {
  const columns: number[][] = [];
  for (let i = 0; i < tracks.length; i += 4) columns.push(Array.from({ length: Math.min(4, tracks.length - i) }, (_, k) => i + k));
  return (
    <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 desk:scroll-px-8 desk:px-8">
      {columns.map((col, ci) => (
        <div key={ci} className="w-[min(88vw,400px)] shrink-0 snap-start desk:w-[380px]">
          {col.map((i) => (
            <CompactRow key={tracks[i].id} tracks={tracks} index={i} label={label} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Mood / genre tiles                                                         */
/* -------------------------------------------------------------------------- */

export function MoodCard({
  title,
  color,
  artwork,
  href,
  onClick,
  className,
}: {
  title: string;
  color: string;
  artwork?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const shade = `color-mix(in srgb, ${color} 32%, black)`;
  const body = (
    <>
      <div className="absolute inset-y-0 right-0 w-[72%]" style={{ background: `color-mix(in srgb, ${color} 55%, black)` }}>
        {artwork && (
          <div className="duotone absolute inset-0" style={{ background: `color-mix(in srgb, ${color} 70%, white)`, ["--shade" as string]: shade }}>
            <Artwork src={artwork} size={220} rounded="rounded-none" className="h-full w-full" />
          </div>
        )}
      </div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.24), transparent 62%)" }} />
      <span className="absolute top-3 left-3.5 right-3 line-clamp-2 text-[16px] leading-tight font-bold text-white [text-shadow:0_1px_6px_rgba(0,0,0,.35)]">
        {title}
      </span>
    </>
  );
  const cls = cx(
    "relative block aspect-[1.72] overflow-hidden rounded-[18px] text-left transition-transform duration-200 hover:scale-[1.015] active:scale-[0.98]",
    className
  );
  const style = { background: `color-mix(in srgb, ${color} 92%, black)` };
  if (href)
    return (
      <Link href={href} className={cls} style={style}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {body}
    </button>
  );
}
