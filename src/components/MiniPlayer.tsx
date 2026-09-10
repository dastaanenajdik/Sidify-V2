"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, Heart, ListMusic, MonitorSpeaker, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { usePlayer, currentTrack } from "@/store/player";
import { next, prev, togglePlay, setVolume } from "@/lib/audioEngine";
import { useLiked } from "@/lib/library";
import { upscaleArtwork, cx } from "@/lib/format";
import { LiveEq } from "./SidifyLogo";
import SeekBar from "./SeekBar";
import { Slider } from "./controls";

export default function MiniPlayer() {
  const track = usePlayer((s) => currentTrack(s));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const volume = usePlayer((s) => s.volume);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const liked = usePlayer((s) => (track ? !!s.likedIds[track.id] : false));
  const { toggle } = useLiked();

  if (!track) return null;

  const openFull = () => usePlayer.getState().set({ fullPlayerOpen: true });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 90, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 90, opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed right-2 bottom-[72px] left-2 z-40 md:right-0 md:bottom-0 md:left-[248px]"
      >
        {/* Mobile floating pill */}
        <div
          className="glass-strong relative flex h-16 cursor-pointer items-center gap-3 overflow-hidden rounded-2xl px-3 md:hidden"
          onClick={openFull}
          style={{ boxShadow: "0 18px 44px -12px var(--shadow)" }}
        >
          <MiniProgress />
          <motion.img
            layoutId={`art-${track.id}`}
            src={upscaleArtwork(track.artwork, 200)}
            alt=""
            className="h-11 w-11 rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{track.title}</div>
            <div className="text-muted truncate text-[11.5px]">{track.artist}</div>
          </div>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={(e) => {
              e.stopPropagation();
              void togglePlay();
            }}
            className="grid h-10 w-10 place-items-center rounded-full accent-bg text-black"
          >
            {isPlaying ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />}
          </button>
          <button
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              void next(true);
            }}
            className="text-muted grid h-9 w-9 place-items-center"
          >
            <SkipForward size={19} fill="currentColor" />
          </button>
        </div>

        {/* Desktop bar */}
        <div
          className="glass-strong relative hidden h-[86px] cursor-pointer items-center gap-5 border-t border-[var(--border)] px-5 md:flex"
          onClick={openFull}
        >
          <div className="absolute -top-[1px] right-0 left-0 h-[3px]" onClick={(e) => e.stopPropagation()}>
            <SeekBar showTimes={false} className="absolute inset-x-0 -top-[2px] [&_input]:h-[4px]" />
          </div>

          {/* left: identity */}
          <div className="flex w-[26%] min-w-0 items-center gap-3">
            <motion.img
              layoutId={`art-${track.id}`}
              src={upscaleArtwork(track.artwork, 300)}
              alt=""
              className="h-13 w-13 rounded-xl object-cover"
              style={{ width: 52, height: 52, boxShadow: "0 8px 24px -8px rgba(0,0,0,.6)" }}
            />
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold">{track.title}</div>
              <div className="text-muted truncate text-[12px]">{track.artist}</div>
            </div>
            <div className="ml-1 hidden lg:block">{isPlaying && <LiveEq size={13} />}</div>
            <button
              aria-label="Like"
              onClick={(e) => {
                e.stopPropagation();
                void toggle(track);
              }}
              className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors", liked ? "accent-text" : "text-muted hover:text-[var(--text)]")}
            >
              <Heart size={17} fill={liked ? "currentColor" : "none"} />
            </button>
          </div>

          {/* center: transport */}
          <div className="flex flex-1 items-center justify-center gap-2">
            <button aria-label="Previous" onClick={(e) => { e.stopPropagation(); void prev(); }} className="text-muted grid h-10 w-10 place-items-center rounded-full hover:text-[var(--text)]">
              <SkipBack size={19} fill="currentColor" />
            </button>
            <button
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={(e) => {
                e.stopPropagation();
                void togglePlay();
              }}
              className="grid h-11 w-11 place-items-center rounded-full bg-[var(--text)] text-[var(--bg)] transition-transform hover:scale-105 active:scale-95"
            >
              {isPlaying ? <Pause size={19} fill="currentColor" strokeWidth={0} /> : <Play size={19} fill="currentColor" strokeWidth={0} className="translate-x-[1.5px]" />}
            </button>
            <button aria-label="Next" onClick={(e) => { e.stopPropagation(); void next(true); }} className="text-muted grid h-10 w-10 place-items-center rounded-full hover:text-[var(--text)]">
              <SkipForward size={19} fill="currentColor" />
            </button>
          </div>

          {/* right: utilities */}
          <div className="flex w-[26%] items-center justify-end gap-1">
            <button
              aria-label="Queue"
              onClick={(e) => {
                e.stopPropagation();
                usePlayer.getState().set({ queueOpen: !queueOpen, fullPlayerOpen: true });
              }}
              className={cx("grid h-9 w-9 place-items-center rounded-full", queueOpen ? "accent-text" : "text-muted hover:text-[var(--text)]")}
            >
              <ListMusic size={18} />
            </button>
            <button
              aria-label="Devices"
              onClick={(e) => e.stopPropagation()}
              className="text-muted grid h-9 w-9 place-items-center rounded-full hover:text-[var(--text)]"
            >
              <MonitorSpeaker size={18} />
            </button>
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                aria-label="Mute"
                onClick={() => setVolume(volume === 0 ? 0.85 : 0)}
                className="text-muted grid h-9 w-9 place-items-center rounded-full hover:text-[var(--text)]"
              >
                {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <div className="hidden w-24 lg:block">
                <Slider value={Math.round(volume * 100)} min={0} max={100} onChange={(v) => setVolume(v / 100)} ariaLabel="Volume" />
              </div>
            </div>
            <button aria-label="Expand player" onClick={(e) => { e.stopPropagation(); openFull(); }} className="text-muted grid h-9 w-9 place-items-center rounded-full hover:text-[var(--text)]">
              <ChevronUp size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function MiniProgress() {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  return (
    <div className="absolute top-0 right-0 left-0 h-[2.5px] bg-[var(--panel-strong)]">
      <div className="h-full accent-bg transition-[width] duration-300 ease-linear" style={{ width: `${pct}%` }} />
    </div>
  );
}
