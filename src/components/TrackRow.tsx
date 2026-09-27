"use client";

import { Check, Download, Heart, Loader2, ListMusic, MoreHorizontal } from "lucide-react";
import type { Track } from "@/lib/types";
import { cx, formatTime, upscaleArtwork } from "@/lib/format";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { playContext } from "@/lib/audioEngine";
import { useLiked, downloadTrackFlow } from "@/lib/library";
import { LiveEq } from "./SidifyLogo";

export default function TrackRow({
  tracks,
  index,
  showArt = true,
  showAlbum = true,
  numbered = false,
  contextLabel,
}: {
  tracks: Track[];
  index: number;
  showArt?: boolean;
  showAlbum?: boolean;
  numbered?: boolean;
  contextLabel?: string;
}) {
  const track = tracks[index];
  const isCurrent = usePlayer((s) => currentTrack(s)?.id === track.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const liked = usePlayer((s) => !!s.likedIds[track.id]);
  const downloaded = usePlayer((s) => !!s.downloadedIds[track.id]);
  const progress = useUi((s) => s.downloadProgress[track.id]);
  const { toggle } = useLiked();

  if (!track) return null;

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      onClick={() => playContext(tracks, index, contextLabel)}
      onContextMenu={openMenu}
      className={cx(
        "hover-panel group grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-3 py-2",
        isCurrent && "bg-[var(--panel-strong)]"
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && playContext(tracks, index, contextLabel)}
    >
      {/* index / eq */}
      <div className="grid w-7 place-items-center">
        {isCurrent ? (
          <LiveEq paused={!isPlaying} size={15} />
        ) : (
          <span className={cx("text-muted-2 text-[13px] tabular-nums", numbered ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
            {numbered ? index + 1 : <ListMusic size={15} />}
          </span>
        )}
      </div>

      {/* art + names */}
      <div className="flex min-w-0 items-center gap-3">
        {showArt && (
          <img
            src={upscaleArtwork(track.artwork, 200)}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-11 w-11 shrink-0 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0">
          <div className={cx("truncate text-[14px] font-medium", isCurrent && "accent-text")}>{track.title}</div>
          <div className="text-muted flex min-w-0 items-center gap-1.5 truncate text-[12.5px]">
            {track.explicit && (
              <span className="rounded-[4px] bg-[var(--panel-strong)] px-1 text-[9.5px] font-bold tracking-wide">E</span>
            )}
            {downloaded && <Download size={11} className="accent-text shrink-0" />}
            <span className="truncate">{track.artist}</span>
          </div>
        </div>
      </div>

      {/* right cluster */}
      <div className="flex items-center gap-1">
        {showAlbum && track.album && (
          <span className="text-muted mr-4 hidden w-40 truncate text-right text-[12.5px] xl:inline-block">
            {track.album}
          </span>
        )}
        <button
          aria-label="Like"
          onClick={(e) => {
            e.stopPropagation();
            void toggle(track);
          }}
          className={cx(
            "grid h-8 w-8 place-items-center rounded-full transition-all",
            liked ? "accent-text opacity-100" : "text-muted hover:text-[var(--text)] md:opacity-0 md:group-hover:opacity-100"
          )}
        >
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
        </button>
        <button
          aria-label="Download"
          onClick={(e) => {
            e.stopPropagation();
            void downloadTrackFlow(track);
          }}
          className={cx(
            "relative grid h-8 w-8 place-items-center rounded-full transition-all",
            downloaded
              ? "accent-text"
              : "text-muted hover:text-[var(--text)] md:opacity-0 md:group-hover:opacity-100",
            progress != null && "opacity-100"
          )}
        >
          {progress != null ? (
            progress > 97 ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <span className="text-[9px] font-bold tabular-nums">{progress}</span>
            )
          ) : downloaded ? (
            <Check size={15} />
          ) : (
            <Download size={15} />
          )}
        </button>
        <span className="text-muted-2 hidden w-10 text-right text-[12.5px] tabular-nums sm:inline">
          {formatTime(track.durationMs)}
        </span>
        <button
          aria-label="More options"
          onClick={openMenu}
          className="text-muted grid h-8 w-8 place-items-center rounded-full hover:text-[var(--text)] md:opacity-0 md:group-hover:opacity-100"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
    </div>
  );
}
