"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, MoreHorizontal, Repeat, Repeat1, Shuffle, Volume1, Volume2, VolumeX } from "lucide-react";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import { next, prev, seekTo, setVolume, togglePlay } from "@/lib/audioEngine";
import { useToggleLike } from "@/lib/library";
import { useRoomSummary } from "@/lib/rooms/client";
import { cx, formatTime } from "@/lib/format";
import { LogoMark } from "../Logo";
import { BackwardGlyph, ForwardGlyph, LyricsGlyph, PauseGlyph, PeopleGlyph, PlayGlyph, QueueGlyph } from "../icons";
import { Artwork, IconButton, Range } from "../ui";

/**
 * The desktop's player: transport on the left, the "LCD" in the middle (what's
 * playing, with a hairline of progress), volume and the panel toggles on the
 * right. There is no bottom bar — this is it.
 */
export default function TopBar() {
  const router = useRouter();
  const isPlaying = usePlayer((s) => s.isPlaying);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const hasTrack = usePlayer((s) => !!currentTrack(s));
  const sidePanel = useUi((s) => s.sidePanel);
  const room = useRoomSummary();

  return (
    <header className="chrome-glass relative z-20 hidden h-[60px] shrink-0 items-center gap-3 px-3 shadow-[inset_0_-0.5px_0_var(--hairline)] desk:flex">
      <div className="flex items-center gap-0.5">
        <IconButton label="Back" size={30} onClick={() => router.back()}>
          <ChevronLeft size={19} />
        </IconButton>
        <IconButton label="Forward" size={30} onClick={() => window.history.forward()}>
          <ChevronRight size={19} />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          label={shuffle ? "Shuffle on" : "Shuffle"}
          size={32}
          disabled={room.inRoom}
          onClick={() => usePlayer.getState().set({ shuffle: !shuffle })}
          className={shuffle && !room.inRoom ? "text-playing" : "text-fg-2"}
        >
          <Shuffle size={16} />
        </IconButton>
        <IconButton label="Previous" size={32} disabled={!hasTrack} onClick={() => void prev()}>
          <BackwardGlyph size={20} />
        </IconButton>
        <IconButton label={isPlaying ? "Pause" : "Play"} size={38} disabled={!hasTrack} onClick={() => void togglePlay()}>
          {isPlaying ? <PauseGlyph size={22} /> : <PlayGlyph size={22} />}
        </IconButton>
        <IconButton label="Next" size={32} disabled={!hasTrack} onClick={() => void next(true)}>
          <ForwardGlyph size={20} />
        </IconButton>
        <IconButton
          label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat"}
          size={32}
          disabled={room.inRoom}
          onClick={() => {
            const order = ["off", "all", "one"] as const;
            usePlayer.getState().set({ repeat: order[(order.indexOf(repeat) + 1) % 3] });
          }}
          className={repeat !== "off" && !room.inRoom ? "text-playing" : "text-fg-2"}
        >
          {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
        </IconButton>
      </div>

      <div className="flex min-w-0 flex-1 justify-center px-2">
        <Lcd />
      </div>

      <div className="flex items-center gap-1">
        <VolumeControl />
        <IconButton
          label="Lyrics"
          size={32}
          active={sidePanel === "lyrics"}
          onClick={() => useUi.getState().toggleSidePanel("lyrics")}
          style={{ ["--qb" as string]: "var(--raised)" }}
        >
          <LyricsGlyph size={18} />
        </IconButton>
        <IconButton label="Queue" size={32} active={sidePanel === "queue"} onClick={() => useUi.getState().toggleSidePanel("queue")}>
          <QueueGlyph size={17} />
        </IconButton>
        <Link
          href={room.code ? `/rooms/${room.code}` : "/rooms"}
          aria-label="Listen Together"
          title="Listen Together"
          className={cx(
            "relative grid h-8 shrink-0 place-items-center rounded-full px-2 transition-colors",
            room.inRoom ? "bg-brand text-white" : "text-fg hover:bg-fill"
          )}
        >
          <span className="flex items-center gap-1">
            <PeopleGlyph size={18} />
            {room.inRoom && <span className="text-[12px] font-bold tabular-nums">{room.count}</span>}
          </span>
        </Link>
        <Avatar />
      </div>
    </header>
  );
}

function Avatar() {
  const name = useSettings((s) => s.profileName);
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 text-[13px] font-bold text-white"
    >
      {(name || "S").trim().charAt(0).toUpperCase()}
    </Link>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const before = useRef(0.85);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="mr-1 flex items-center gap-1.5">
      <IconButton
        label={volume === 0 ? "Unmute" : "Mute"}
        size={28}
        className="text-fg-2"
        onClick={() => {
          if (volume > 0) {
            before.current = volume;
            setVolume(0);
          } else setVolume(before.current || 0.85);
        }}
      >
        <Icon size={16} />
      </IconButton>
      <Range label="Volume" value={Math.round(volume * 100)} onChange={(v) => setVolume(v / 100)} className="w-[68px] xl:w-[92px]" />
    </div>
  );
}

/** Isolated progress & scrubber leaf so playback ticks never re-render Lcd artwork/buttons. */
function LcdProgress({ fallbackDurationMs }: { fallbackDurationMs: number }) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs || fallbackDurationMs || 0);
  const isLoading = usePlayer((s) => s.isLoading);
  const [scrub, setScrub] = useState<number | null>(null);

  const pos = scrub ?? positionMs;
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, pos / durationMs)) : 0;

  return (
    <>
      <span className="pointer-events-none absolute bottom-[5px] left-[54px] text-[10px] text-fg-2 tabular-nums opacity-0 transition-opacity group-hover/lcd:opacity-100">
        {formatTime(pos)}
      </span>
      <span className="pointer-events-none absolute right-2 bottom-[5px] text-[10px] text-fg-2 tabular-nums opacity-0 transition-opacity group-hover/lcd:opacity-100">
        -{formatTime(Math.max(0, durationMs - pos))}
      </span>
      <div className="absolute right-0 bottom-0 left-[46px] h-[2px] overflow-hidden bg-fill-2">
        <div
          className={cx("h-full w-full origin-left bg-fg-2", isLoading && "animate-pulse")}
          style={{ transform: `scaleX(${ratio.toFixed(4)})` }}
        />
      </div>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={Math.max(1, durationMs)}
        step={1000}
        value={Math.min(pos, durationMs)}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={(e) => {
          seekTo(Number((e.target as HTMLInputElement).value));
          setScrub(null);
        }}
        onKeyUp={(e) => {
          seekTo(Number((e.target as HTMLInputElement).value));
          setScrub(null);
        }}
        className="absolute right-0 bottom-[-6px] left-[46px] h-3 cursor-pointer opacity-0"
      />
    </>
  );
}

function Lcd() {
  const track = usePlayer((s) => currentTrack(s));
  const liked = usePlayer((s) => !!(track && s.likedIds[track.id]));
  const contextLabel = usePlayer((s) => s.contextLabel);
  const toggle = useToggleLike();

  if (!track) {
    return (
      <div className="flex h-[46px] w-full max-w-[560px] items-center justify-center gap-2 rounded-[6px] bg-lcd text-fg-3">
        <LogoMark size={20} />
        <span className="text-[13px] font-medium">Pick something to play</span>
      </div>
    );
  }

  const open = () => usePlayer.getState().set({ fullPlayerOpen: true });

  return (
    <div className="group/lcd relative flex h-[46px] w-full max-w-[560px] items-center overflow-hidden rounded-[6px] bg-lcd">
      <button type="button" onClick={open} aria-label="Open Now Playing" className="h-[46px] w-[46px] shrink-0">
        <Artwork src={track.artwork} size={46} rounded="rounded-none" className="h-full w-full" />
      </button>
      <button type="button" onClick={open} className="min-w-0 flex-1 px-3 text-center">
        <div className="truncate text-[13px] leading-tight font-semibold">{track.title}</div>
        <div className="truncate text-[12px] leading-tight text-fg-2">
          {track.artist}
          {contextLabel && contextLabel !== "Single track" ? ` — ${contextLabel}` : track.album ? ` — ${track.album}` : ""}
        </div>
      </button>
      <div className="flex shrink-0 items-center pr-1.5">
        <IconButton
          label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
          size={28}
          onClick={() => void toggle(track)}
          className={liked ? "text-playing" : "text-fg-2 opacity-0 group-hover/lcd:opacity-100"}
        >
          <Heart size={15} fill={liked ? "currentColor" : "none"} />
        </IconButton>
        <IconButton
          label="More"
          size={28}
          className="text-fg-2 opacity-0 group-hover/lcd:opacity-100"
          onClick={(e) => useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY })}
        >
          <MoreHorizontal size={16} />
        </IconButton>
      </div>

      <LcdProgress fallbackDurationMs={track.durationMs || 0} />
    </div>
  );
}
