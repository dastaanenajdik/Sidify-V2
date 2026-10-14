"use client";

import type { ReactNode } from "react";
import { Play, Shuffle } from "lucide-react";
import { useSettings } from "@/store/settings";
import { dim, usePalette } from "@/lib/palette";
import { art, cx } from "@/lib/format";
import { Artwork, Skeleton } from "./ui";

/**
 * The top of an album / playlist / artist page: the artwork bleeding edge to
 * edge and fading into its own dominant colour, a centred bold title, a small
 * meta line, and round shuffle · Play pill · round action.
 */
export default function CollectionHeader({
  artwork,
  arts,
  cover,
  eyebrow,
  title,
  subtitle,
  meta,
  onPlay,
  onShuffle,
  action,
  disabled,
  round,
  below,
}: {
  artwork?: string;
  arts?: string[];
  /** Replaces the artwork entirely (Liked Songs' heart). */
  cover?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: string;
  onPlay?: () => void;
  onShuffle?: () => void;
  action?: ReactNode;
  disabled?: boolean;
  round?: boolean;
  below?: ReactNode;
}) {
  const dynamic = useSettings((s) => s.dynamicColor);
  const palette = usePalette(artwork || arts?.[0], dynamic && !cover);
  const base = cover ? "#3a0d16" : dim(palette[0], 0.16);

  const art4 = arts && arts.length >= 4 ? arts.slice(0, 4) : null;
  const squareArt = cover ? (
    cover
  ) : art4 ? (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden">
      {art4.map((a, i) => (
        <Artwork key={i} src={a} size={160} rounded="rounded-none" className="h-full w-full" />
      ))}
    </div>
  ) : (
    <Artwork src={artwork || arts?.[0]} size={320} rounded="rounded-none" eager className="h-full w-full" />
  );

  const buttons = (
    <div className="mt-5 flex items-center justify-center gap-3 desk:justify-start">
      {onShuffle && (
        <button
          type="button"
          aria-label="Shuffle"
          disabled={disabled}
          onClick={onShuffle}
          className="grid h-11 w-11 place-items-center rounded-full bg-white/14 text-white backdrop-blur-xl transition-colors hover:bg-white/22 disabled:opacity-40"
        >
          <Shuffle size={18} />
        </button>
      )}
      {onPlay && (
        <button
          type="button"
          disabled={disabled}
          onClick={onPlay}
          className="flex h-11 min-w-[132px] items-center justify-center gap-2 rounded-full bg-black/45 px-7 text-[15px] font-semibold text-white ring-1 ring-white/10 backdrop-blur-xl transition-colors hover:bg-black/60 disabled:opacity-40"
        >
          <Play size={16} fill="currentColor" /> Play
        </button>
      )}
      {action}
    </div>
  );

  return (
    <header className="relative isolate text-white">
      {/* phones: full-bleed artwork */}
      <div className="relative desk:hidden">
        <div className={cx("relative aspect-square w-full overflow-hidden", round && "mx-auto mt-6 aspect-square w-[64%] rounded-full")}>
          {round ? (
            <Artwork src={artwork} size={320} round eager className="h-full w-full" />
          ) : (
            <>
              <div className="absolute inset-0">{squareArt}</div>
              <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 45%, ${base} 100%)` }} />
            </>
          )}
        </div>
        <div className="relative px-5 pt-1 pb-6 text-center" style={{ background: round ? "transparent" : base }}>
          {eyebrow && <div className="t-eyebrow mb-1 text-white/60">{eyebrow}</div>}
          <h1 className="text-[26px] leading-tight font-extrabold tracking-[-0.6px] [overflow-wrap:anywhere]">{title}</h1>
          {subtitle && <div className="mt-1 text-[17px] font-medium text-white/80">{subtitle}</div>}
          {meta && <div className="mt-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-white/55 uppercase">{meta}</div>}
          {buttons}
          {below}
        </div>
      </div>

      {/* desktop: art + text over the colour */}
      <div className="relative hidden overflow-hidden desk:block">
        {!cover && (artwork || arts?.[0]) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art(artwork || arts?.[0], 300)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-[60px]" />
        )}
        <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${base} 55%, transparent), ${base})` }} />
        <div className="relative flex items-end gap-8 px-8 pt-14 pb-8">
          <div
            className={cx(
              "h-[236px] w-[236px] shrink-0 overflow-hidden shadow-[0_24px_60px_-16px_rgba(0,0,0,.7)] ring-1 ring-white/10",
              round ? "rounded-full" : "rounded-[12px]"
            )}
          >
            {round ? <Artwork src={artwork} size={240} round eager className="h-full w-full" /> : squareArt}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            {eyebrow && <div className="t-eyebrow mb-1.5 text-white/60">{eyebrow}</div>}
            <h1 className="line-clamp-2 text-[44px] leading-[1.05] font-extrabold tracking-[-1px] [overflow-wrap:anywhere]">{title}</h1>
            {subtitle && <div className="mt-2 text-[19px] font-medium text-white/85">{subtitle}</div>}
            {meta && <div className="mt-1.5 text-[12px] font-semibold tracking-[0.06em] text-white/55 uppercase">{meta}</div>}
            {buttons}
            {below}
          </div>
        </div>
      </div>
      <div className="h-10" style={{ background: round ? "transparent" : `linear-gradient(180deg, ${base}, transparent)` }} />
    </header>
  );
}

/** Round secondary action beside the Play pill. */
export function HeaderAction({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "grid h-11 w-11 place-items-center rounded-full backdrop-blur-xl transition-colors",
        active ? "bg-white text-black" : "bg-white/14 text-white hover:bg-white/22"
      )}
    >
      {children}
    </button>
  );
}

export function CollectionSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-square w-full rounded-none desk:aspect-auto desk:h-[320px]" />
      <div className="space-y-2 px-4 pt-6 desk:px-8">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-[8px]" />
        ))}
      </div>
    </div>
  );
}
