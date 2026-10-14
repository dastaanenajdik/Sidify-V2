"use client";

import { Heart, MoreHorizontal, X } from "lucide-react";
import type { Track } from "@/lib/types";
import { playContext } from "@/lib/audioEngine";
import { useLiked } from "@/lib/library";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { cx, formatTime } from "@/lib/format";
import { Artwork } from "./ui";
import { PlayingBars } from "./icons";

/**
 * One song in a list: 52px artwork (or the track number on album pages),
 * title and artist, a hairline under the text, and the "…" menu.
 */
export default function TrackRow({
  tracks,
  index,
  contextLabel = "",
  numbered = false,
  showArt,
  subtitle,
  onRemove,
  removeLabel = "Remove",
  onPlay,
}: {
  tracks: Track[];
  index: number;
  contextLabel?: string;
  numbered?: boolean;
  showArt?: boolean;
  subtitle?: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** Override the default "play this list from here". */
  onPlay?: () => void;
}) {
  const t = tracks[index];
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === t?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const liked = usePlayer((s) => !!(t && s.likedIds[t.id]));
  const { toggle } = useLiked();
  if (!t) return null;
  const withArt = showArt ?? !numbered;

  const play = () => (onPlay ? onPlay() : playContext(tracks, index, contextLabel));
  const menu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === "Enter") play();
      }}
      onContextMenu={menu}
      className={cx(
        "group/row relative flex cursor-default items-center gap-3 rounded-[8px] px-2 transition-colors duration-100 select-none hover:bg-fill",
        withArt ? "h-[64px]" : "h-[52px]"
      )}
    >
      {numbered && (
        <span className="grid w-7 shrink-0 place-items-center text-[15px] text-fg-2 tabular-nums">
          {isCurrent ? <PlayingBars paused={!isPlaying} size={12} className="text-playing" /> : index + 1}
        </span>
      )}
      {withArt && (
        <span className="relative shrink-0">
          <Artwork src={t.artwork} size={52} rounded="rounded-[6px]" className="h-[52px] w-[52px]" />
          {isCurrent && !numbered && (
            <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-black/45 text-white">
              <PlayingBars paused={!isPlaying} size={13} />
            </span>
          )}
        </span>
      )}

      <span
        className={cx(
          "relative flex h-full min-w-0 flex-1 items-center gap-3",
          // hairline under the text, not under the artwork
          "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:origin-bottom after:scale-y-50 after:bg-divider group-last/row:after:hidden"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[15px] leading-snug", isCurrent && "text-playing")}>{t.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-snug text-fg-2">
            {t.explicit && (
              <span className="grid h-[14px] min-w-[14px] shrink-0 place-items-center rounded-[3px] bg-fill-3 px-[3px] text-[9px] font-bold text-fg-2">
                E
              </span>
            )}
            <span className="truncate">{subtitle ?? t.artist}</span>
          </span>
        </span>

        <button
          type="button"
          aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          onClick={(e) => {
            e.stopPropagation();
            void toggle(t);
          }}
          className={cx(
            "hidden h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity sm:grid",
            liked ? "text-playing" : "text-fg-2 opacity-0 group-hover/row:opacity-100 hover:text-fg"
          )}
        >
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
        </button>
        <span className="hidden w-11 shrink-0 text-right text-[13px] text-fg-2 tabular-nums sm:block">
          {t.durationMs ? formatTime(t.durationMs) : ""}
        </span>
        {onRemove && (
          <button
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-danger"
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          aria-label="More"
          onClick={menu}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <MoreHorizontal size={18} />
        </button>
      </span>
    </div>
  );
}
