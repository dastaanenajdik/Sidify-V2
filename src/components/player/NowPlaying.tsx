"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, Heart, MoreHorizontal, Repeat, Repeat1, Shuffle, Volume1, Volume2, VolumeX } from "lucide-react";
import type { Track } from "@/lib/types";
import { usePlayer, currentTrack, upNextTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import { next, prev, seekTo, setAutoplay, setVolume, togglePlay } from "@/lib/audioEngine";
import { ytController } from "@/lib/ytPlayer";
import { useLiked } from "@/lib/library";
import { useRoom, useRoomSummary } from "@/lib/rooms/client";
import { art, cx, formatTime } from "@/lib/format";
import MeshBackdrop from "../MeshBackdrop";
import { BackwardGlyph, ForwardGlyph, InfinityGlyph, LyricsGlyph, OutputGlyph, PauseGlyph, PeopleGlyph, PlayGlyph, QueueGlyph } from "../icons";
import { Range } from "../ui";
import LyricsPane from "./LyricsPane";
import QueueList from "./QueueList";
import PlaybackSheet from "./PlaybackSheet";

/**
 * Now Playing — full screen, over everything. The artwork's own colours make
 * the backdrop; the artwork breathes down a little when paused; lyrics and the
 * queue take over the artwork's place (and get a column of their own on wide
 * screens).
 */
export default function NowPlaying() {
  const open = usePlayer((s) => s.fullPlayerOpen);
  const track = usePlayer((s) => currentTrack(s));
  return <AnimatePresence>{open && track && <Sheet key="np" track={track} />}</AnimatePresence>;
}

const EASE = [0.215, 0.61, 0.355, 1] as const;

function Sheet({ track }: { track: Track }) {
  const view = usePlayer((s) => s.npView);
  const videoMode = usePlayer((s) => s.videoMode);
  const contextLabel = usePlayer((s) => s.contextLabel);
  const room = useRoomSummary();
  const drag = useDragControls();
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const close = () => usePlayer.getState().set({ fullPlayerOpen: false });
  const setView = (v: "art" | "lyrics" | "queue") => usePlayer.getState().set({ npView: usePlayer.getState().npView === v ? "art" : v });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") usePlayer.getState().set({ fullPlayerOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showSide = view !== "art";
  const playingFrom = room.inRoom ? `Listening together · ${room.count}` : contextLabel && contextLabel !== "Single track" ? contextLabel : "";

  return (
    <motion.div
      className="fixed inset-0 z-[90] overflow-hidden bg-black text-white"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 34, stiffness: 300 }}
      drag="y"
      dragListener={false}
      dragControls={drag}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.7 }}
      onDragEnd={(_e, info) => {
        if (info.offset.y > 120 || info.velocity.y > 650) close();
      }}
      role="dialog"
      aria-label="Now Playing"
    >
      <MeshBackdrop artwork={track.artwork} driftKey={track.id} />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1280px] flex-col pt-safe">
        {/* header — also the drag handle */}
        <div className="shrink-0 touch-none px-5 pt-2 desk:px-8 desk:pt-5" onPointerDown={(e) => drag.start(e)}>
          <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-white/35 desk:hidden" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Close Now Playing"
              onClick={close}
              onPointerDown={(e) => e.stopPropagation()}
              className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/10"
            >
              <ChevronDown size={24} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              {playingFrom && (
                <>
                  <div className="text-[11px] font-semibold tracking-[0.08em] text-white/55 uppercase">{room.inRoom ? "Listen Together" : "Playing from"}</div>
                  <div className="truncate text-[13px] font-semibold text-white/90">{room.inRoom ? room.room?.name : playingFrom}</div>
                </>
              )}
            </div>
            <button
              type="button"
              aria-label="More"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY })}
              className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/10"
            >
              <MoreHorizontal size={22} />
            </button>
          </div>
        </div>

        <div className={cx("flex min-h-0 flex-1 gap-6 sm:gap-10 px-5 sm:px-[30px] pb-4 desk:px-12 desk:pb-8", showSide ? "desk:flex-row" : "flex-col items-center")}>
          {/* main column */}
          <div className={cx("mx-auto flex min-h-0 w-full max-w-[560px] flex-1 flex-col", showSide && "desk:mx-0 desk:max-w-[460px] desk:flex-none desk:basis-[440px]")}>
            {/* art / lyrics / queue area (phones swap; wide screens keep the art) */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className={cx("min-h-0 flex-1 py-3", view !== "art" ? "hidden desk:block" : "block")}>
                {videoMode && track.videoId ? <VideoSlot track={track} /> : <Art track={track} />}
              </div>
              {view !== "art" && (
                <div className="flex min-h-0 flex-1 flex-col desk:hidden">
                  <CompactHead track={track} />
                  {view === "lyrics" ? (
                    <LyricsPane key={track.id} track={track} variant="player" className="min-h-0 flex-1" />
                  ) : (
                    <div className="no-scrollbar -mx-2 min-h-0 flex-1 overflow-y-auto">
                      <QueueList variant="player" />
                    </div>
                  )}
                </div>
              )}
            </div>

            {(view === "art" || showSide) && (
              <div className={cx(view !== "art" && "hidden desk:block")}>
                <TitleRow track={track} />
              </div>
            )}
            <Scrubber track={track} />
            <Transport />
            <VolumeRow />
            <BottomRow view={view} onView={setView} onOutput={() => setPlaybackOpen(true)} />
            <UpNext />
          </div>

          {/* wide screens: lyrics / queue in their own column */}
          {showSide && (
            <div className="hidden min-h-0 min-w-0 flex-1 flex-col desk:flex">
              {view === "lyrics" ? (
                <LyricsPane key={track.id} track={track} variant="player" className="min-h-0 flex-1" />
              ) : (
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
                  <h2 className="px-2 pt-2 text-[22px] font-bold tracking-[-0.4px]">Queue</h2>
                  <QueueList variant="player" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <PlaybackSheet open={playbackOpen} onClose={() => setPlaybackOpen(false)} />
    </motion.div>
  );
}

function Art({ track }: { track: Track }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const reduce = useSettings((s) => s.reduceMotion);
  const side = "min(100cqw, 100cqh, 560px)";
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <motion.img
        key={track.id}
        src={art(track.artwork, 1000)}
        alt={track.title}
        draggable={false}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, scale: isPlaying || reduce ? 1 : 0.88 }}
        transition={{ opacity: { duration: 0.4 }, scale: { duration: 0.5, ease: EASE } }}
        className="rounded-[12px] bg-white/10 object-cover shadow-[0_28px_70px_-18px_rgba(0,0,0,.65)]"
        style={{ width: side, height: side }}
      />
    </div>
  );
}

function VideoSlot({ track }: { track: Track }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ytController.attachTo(ref.current);
    return () => ytController.detachToHarbor();
  }, [track.id]);
  return (
    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
      <div
        ref={ref}
        className="aspect-video overflow-hidden rounded-[12px] bg-black shadow-[0_28px_70px_-18px_rgba(0,0,0,.65)] [&_iframe]:h-full [&_iframe]:w-full"
        style={{ width: "min(100cqw, calc(100cqh * 16 / 9))" }}
      />
    </div>
  );
}

function CompactHead({ track }: { track: Track }) {
  return (
    <div className="flex shrink-0 items-center gap-3 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art(track.artwork, 120)} alt="" className="h-14 w-14 rounded-[8px] object-cover shadow-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-semibold">{track.title}</div>
        <div className="truncate text-[14px] text-white/60">{track.artist}</div>
      </div>
      <LikeCircle track={track} />
    </div>
  );
}

function LikeCircle({ track }: { track: Track }) {
  const liked = usePlayer((s) => !!s.likedIds[track.id]);
  const { toggle } = useLiked();
  return (
    <button
      type="button"
      aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
      onClick={() => void toggle(track)}
      className={cx("grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full transition-colors", liked ? "bg-white/34" : "art-glass hover:bg-white/25")}
    >
      <Heart size={17} fill={liked ? "currentColor" : "none"} />
    </button>
  );
}

function TitleRow({ track }: { track: Track }) {
  return (
    <div className="flex items-center gap-3 pt-5 pb-1">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[21px] leading-tight font-bold tracking-[-0.3px]">{track.title}</div>
        {track.artistId ? (
          <Link
            href={`/artist/${encodeURIComponent(track.artistId)}`}
            onClick={() => usePlayer.getState().set({ fullPlayerOpen: false })}
            className="block truncate text-[18px] leading-tight text-white/60 hover:text-white/80"
          >
            {track.artist}
          </Link>
        ) : (
          <div className="truncate text-[18px] leading-tight text-white/60">{track.artist}</div>
        )}
      </div>
      <LikeCircle track={track} />
      <button
        type="button"
        aria-label="More"
        onClick={(e) => useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY })}
        className="art-glass grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full hover:bg-white/25"
      >
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
}

function qualityLabel(downloaded: boolean, mode: string | null, quality: string, inRoom: boolean) {
  if (inRoom) return "In sync";
  if (downloaded) return "Offline";
  if (mode === "iframe") return "Sidify";
  return quality === "high" ? "High Quality" : quality === "medium" ? "Standard" : "Data Saver";
}

function Scrubber({ track }: { track: Track }) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs || track.durationMs || 0);
  const mode = usePlayer((s) => s.engineMode);
  const downloaded = usePlayer((s) => !!s.downloadedIds[track.id]);
  const quality = useSettings((s) => s.wifiQuality);
  const inRoom = useRoom((s) => !!s.session);
  const [scrub, setScrub] = useState<number | null>(null);
  const pos = scrub ?? positionMs;
  return (
    <div className="pt-3">
      <Range
        label="Seek"
        tone="on-art"
        value={Math.min(pos, durationMs || 1)}
        max={Math.max(1, durationMs)}
        step={500}
        onChange={(v) => setScrub(v)}
        onCommit={(v) => {
          seekTo(v);
          setScrub(null);
        }}
      />
      <div className="mt-0.5 flex items-center justify-between text-[12px] font-medium text-white/55 tabular-nums">
        <span className="w-14">{formatTime(pos)}</span>
        <span className="rounded-[4px] px-1.5 text-[11px] font-semibold tracking-wide text-white/60 uppercase">
          {qualityLabel(downloaded, mode, quality, inRoom)}
        </span>
        <span className="w-14 text-right">-{formatTime(Math.max(0, durationMs - pos))}</span>
      </div>
    </div>
  );
}

function Transport() {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  return (
    <div className="flex items-center justify-around py-3 desk:py-4">
      <button type="button" aria-label="Previous" onClick={() => void prev()} className="grid h-[60px] w-[60px] place-items-center rounded-full active:scale-90 active:bg-white/10">
        <BackwardGlyph size={42} />
      </button>
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => void togglePlay()}
        className={cx("grid h-[76px] w-[76px] place-items-center rounded-full active:scale-90 active:bg-white/10", isLoading && "animate-pulse")}
      >
        {isPlaying ? <PauseGlyph size={58} /> : <PlayGlyph size={58} />}
      </button>
      <button type="button" aria-label="Next" onClick={() => void next(true)} className="grid h-[60px] w-[60px] place-items-center rounded-full active:scale-90 active:bg-white/10">
        <ForwardGlyph size={42} />
      </button>
    </div>
  );
}

function VolumeRow() {
  const volume = usePlayer((s) => s.volume);
  const Low = volume === 0 ? VolumeX : Volume1;
  return (
    <div className="flex items-center gap-3 py-1">
      <button type="button" aria-label="Mute" onClick={() => setVolume(volume > 0 ? 0 : 0.85)} className="text-white/55 hover:text-white/80">
        <Low size={16} />
      </button>
      <Range label="Volume" tone="on-art" big value={Math.round(volume * 100)} onChange={(v) => setVolume(v / 100)} />
      <Volume2 size={16} className="text-white/55" />
    </div>
  );
}

function BottomRow({
  view,
  onView,
  onOutput,
}: {
  view: "art" | "lyrics" | "queue";
  onView: (v: "art" | "lyrics" | "queue") => void;
  onOutput: () => void;
}) {
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const autoplayLocal = useSettings((s) => s.autoplay);
  const room = useRoomSummary();
  const autoplay = room.room ? room.room.autoplay : autoplayLocal;

  const glyphBtn = (on: boolean) =>
    cx("grid h-11 w-11 place-items-center rounded-full transition-colors", on ? "bg-white text-black" : "text-white/80 hover:bg-white/10");

  return (
    <div className="flex items-center justify-between pt-3">
      <button
        type="button"
        aria-label="Lyrics"
        aria-pressed={view === "lyrics"}
        onClick={() => onView("lyrics")}
        className={glyphBtn(view === "lyrics")}
        style={{ ["--qb" as string]: view === "lyrics" ? "#fff" : "#000" }}
      >
        <LyricsGlyph size={22} filled={view === "lyrics"} />
      </button>

      <div className="flex h-11 items-center rounded-full bg-white/12 px-1 backdrop-blur-xl">
        {view === "queue" ? (
          <>
            {!room.inRoom && (
              <>
                <CapsuleBtn label="Shuffle" on={shuffle} onClick={() => usePlayer.getState().set({ shuffle: !shuffle })}>
                  <Shuffle size={18} />
                </CapsuleBtn>
                <Divider />
                <CapsuleBtn
                  label="Repeat"
                  on={repeat !== "off"}
                  onClick={() => {
                    const order = ["off", "all", "one"] as const;
                    usePlayer.getState().set({ repeat: order[(order.indexOf(repeat) + 1) % 3] });
                  }}
                >
                  {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
                </CapsuleBtn>
                <Divider />
              </>
            )}
            <CapsuleBtn label="AutoPlay" on={autoplay} onClick={() => setAutoplay(!autoplay)}>
              <InfinityGlyph size={21} />
            </CapsuleBtn>
          </>
        ) : (
          <>
            <CapsuleBtn label="Playback options" onClick={onOutput}>
              <OutputGlyph size={19} />
            </CapsuleBtn>
            <Divider />
            <Link
              href={room.code ? `/rooms/${room.code}` : "/rooms"}
              onClick={() => usePlayer.getState().set({ fullPlayerOpen: false })}
              aria-label="Listen Together"
              className={cx("flex h-9 items-center gap-1.5 rounded-full px-3.5", room.inRoom ? "text-white" : "text-white/80 hover:bg-white/10")}
            >
              <PeopleGlyph size={19} />
              {room.inRoom && <span className="text-[13px] font-bold tabular-nums">{room.count}</span>}
            </Link>
          </>
        )}
      </div>

      <button type="button" aria-label="Queue" aria-pressed={view === "queue"} onClick={() => onView("queue")} className={glyphBtn(view === "queue")}>
        <QueueGlyph size={21} />
      </button>
    </div>
  );
}

function CapsuleBtn({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cx("grid h-9 min-w-11 place-items-center rounded-full px-3.5 transition-colors", on ? "bg-white text-black" : "text-white/80 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-white/15" />;
}

/** What plays after this one — always visible, because AutoPlay lines it up early. */
function UpNext() {
  const nxt = usePlayer((s) => upNextTrack(s));
  const loading = usePlayer((s) => s.autoplayLoading);
  return (
    <button
      type="button"
      onClick={() => usePlayer.getState().set({ npView: "queue" })}
      className="mt-3 hidden min-h-[36px] items-center justify-center gap-2 text-[12.5px] text-white/55 hover:text-white/80 [@media(min-height:760px)]:flex"
    >
      {nxt ? (
        <>
          <span className="font-semibold tracking-[0.06em] text-white/45 uppercase">Up next</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art(nxt.artwork, 40)} alt="" className="h-5 w-5 rounded-[4px] object-cover" />
          <span className="max-w-[60%] truncate">
            {nxt.title} · {nxt.artist}
          </span>
        </>
      ) : loading ? (
        <span>Lining up similar songs…</span>
      ) : null}
    </button>
  );
}
