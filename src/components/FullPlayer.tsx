"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, Reorder, motion } from "framer-motion";
import {
  ChevronDown,
  Download,
  Gauge,
  GripVertical,
  Heart,
  ListMusic,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings, EQ_PRESETS, EQ_BANDS } from "@/store/settings";
import { next, prev, seekTo, setSpeed, togglePlay, moveInQueue, removeFromQueue, setQueue, playIndex, applySettings, setVideoMode } from "@/lib/audioEngine";
import { ytController } from "@/lib/ytPlayer";
import { useLiked, downloadTrackFlow } from "@/lib/library";
import { cx, formatTime, upscaleArtwork } from "@/lib/format";
import type { Track } from "@/lib/types";
import SeekBar from "./SeekBar";
import { PlayButton, Toggle } from "./controls";
import { LiveEq } from "./SidifyLogo";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export default function FullPlayer() {
  const open = usePlayer((s) => s.fullPlayerOpen);
  const track = usePlayer((s) => currentTrack(s));

  return (
    <AnimatePresence>
      {open && track && <Shell key="fp" track={track} />}
    </AnimatePresence>
  );
}

function Shell({ track }: { track: Track }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const eqOpen = usePlayer((s) => s.eqOpen);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const speed = usePlayer((s) => s.speed);
  const sleepMode = usePlayer((s) => s.sleepMode);
  const contextLabel = usePlayer((s) => s.contextLabel);
  const liked = usePlayer((s) => !!s.likedIds[track.id]);
  const downloaded = usePlayer((s) => !!s.downloadedIds[track.id]);
  const videoMode = usePlayer((s) => s.videoMode);
  const quality = useSettings((s) => s.wifiQuality);
  const { toggle } = useLiked();
  const [speedOpen, setSpeedOpen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);

  const close = () => usePlayer.getState().set({ fullPlayerOpen: false });

  // Video mode: move the live YouTube iframe into the visible slot (keeps position)
  useEffect(() => {
    if (videoMode && slotRef.current) {
      ytController.attachTo(slotRef.current);
      return () => ytController.detachToHarbor();
    }
  }, [videoMode, track.id]);

  return (
    <motion.div
      className="fixed inset-0 z-[70] overflow-hidden"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 32, stiffness: 260 }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_e, info) => {
        if (info.offset.y > 110 || info.velocity.y > 600) close();
      }}
      style={{ background: "var(--bg)" }}
    >
      {/* blurred artwork backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <motion.img
          key={track.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ duration: 0.6 }}
          src={upscaleArtwork(track.artwork, 600)}
          alt=""
          className="h-full w-full scale-150 object-cover blur-[110px] saturate-[1.4]"
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--bg) 55%, transparent), var(--bg) 92%)" }} />
      </div>

      <div className="relative z-10 mx-auto flex h-full max-w-[1400px] flex-col px-5 pt-4 pb-6 md:px-10 md:pt-6">
        {/* header */}
        <div className="flex items-center justify-between">
          <button aria-label="Close player" onClick={close} className="glass grid h-10 w-10 place-items-center rounded-full">
            <ChevronDown size={20} />
          </button>
          <div className="text-center">
            <div className="text-muted-2 text-[10.5px] font-semibold tracking-[0.22em] uppercase">Playing from</div>
            <div className="text-[12.5px] font-semibold">{contextLabel || "Sidify"}</div>
          </div>
          <button
            aria-label="More"
            onClick={(e) => useUi.getState().openMenu({ track, x: e.clientX - 200, y: e.clientY })}
            className="glass grid h-10 w-10 place-items-center rounded-full"
          >
            <MoreHorizontal size={19} />
          </button>
        </div>

        {/* body */}
        <div className="flex min-h-0 flex-1 flex-col gap-6 pt-5 lg:flex-row lg:items-center lg:gap-14">
          {/* artwork / video */}
          <div className="flex min-h-0 flex-1 items-center justify-center lg:justify-end">
            {videoMode && track.videoId ? (
              <div
                ref={slotRef}
                className="aspect-video w-full max-w-[290px] overflow-hidden rounded-[28px] bg-black sm:max-w-[420px] md:max-w-[500px] xl:max-w-[560px]"
                style={{ boxShadow: "0 40px 110px -20px rgba(0,0,0,.7), 0 0 80px -30px var(--glow)" }}
              />
            ) : (
              <motion.img
                layoutId={`art-${track.id}`}
                src={upscaleArtwork(track.artwork, 600)}
                alt={track.title}
                className="floaty aspect-square w-full max-w-[290px] rounded-[28px] object-cover md:max-w-[380px] xl:max-w-[430px]"
                style={{ boxShadow: "0 40px 110px -20px rgba(0,0,0,.7), 0 0 80px -30px var(--glow)" }}
                draggable={false}
              />
            )}
          </div>

          {/* controls column */}
          <div className="flex w-full flex-col lg:max-w-[460px] lg:flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display truncate text-[24px] leading-tight font-bold md:text-[30px]">{track.title}</h1>
                <p className="text-muted truncate text-[15px]">{track.artist}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                    {downloaded ? "Offline" : quality} quality
                  </span>
                  {sleepMode && (
                    <span className="accent-text flex items-center gap-1 rounded-md bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-bold uppercase">
                      <Moon size={10} /> {sleepMode === "eot" ? "End of track" : "Timer on"}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  aria-label="Like"
                  onClick={() => void toggle(track)}
                  className={cx("grid h-10 w-10 place-items-center rounded-full", liked ? "accent-text" : "text-muted hover:text-[var(--text)]")}
                >
                  <Heart size={21} fill={liked ? "currentColor" : "none"} />
                </button>
                <button
                  aria-label="Download"
                  onClick={() => void downloadTrackFlow(track)}
                  className={cx("grid h-10 w-10 place-items-center rounded-full", downloaded ? "accent-text" : "text-muted hover:text-[var(--text)]")}
                >
                  <Download size={19} />
                </button>
              </div>
            </div>

            <SeekBar className="mt-4" />

            {/* transport */}
            <div className="mt-2 flex items-center justify-between">
              <button
                aria-label="Shuffle"
                onClick={() => usePlayer.getState().set({ shuffle: !shuffle })}
                className={cx("grid h-11 w-11 place-items-center rounded-full", shuffle ? "accent-text" : "text-muted hover:text-[var(--text)]")}
                style={shuffle ? { filter: "drop-shadow(0 0 8px var(--glow))" } : undefined}
              >
                <Shuffle size={19} />
              </button>
              <button aria-label="Previous" onClick={() => void prev()} className="grid h-12 w-12 place-items-center rounded-full hover:bg-[var(--panel)]">
                <SkipBack size={26} fill="currentColor" />
              </button>
              <PlayButton playing={isPlaying} size={68} onClick={() => void togglePlay()} label={isPlaying ? "Pause" : "Play"} />
              <button aria-label="Next" onClick={() => void next(true)} className="grid h-12 w-12 place-items-center rounded-full hover:bg-[var(--panel)]">
                <SkipForward size={26} fill="currentColor" />
              </button>
              <button
                aria-label="Repeat"
                onClick={() => {
                  const order: Array<typeof repeat> = ["off", "all", "one"];
                  usePlayer.getState().set({ repeat: order[(order.indexOf(repeat) + 1) % 3] });
                }}
                className={cx("grid h-11 w-11 place-items-center rounded-full", repeat !== "off" ? "accent-text" : "text-muted hover:text-[var(--text)]")}
                style={repeat !== "off" ? { filter: "drop-shadow(0 0 8px var(--glow))" } : undefined}
              >
                {repeat === "one" ? <Repeat1 size={19} /> : <Repeat size={19} />}
              </button>
            </div>

            {/* utility row */}
            <div className="mt-3 flex items-center justify-between">
              <div className="relative">
                <button
                  onClick={() => setSpeedOpen((v) => !v)}
                  className={cx(
                    "glass flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold",
                    speed !== 1 ? "accent-text" : "text-muted"
                  )}
                >
                  <Gauge size={15} /> {speed}x
                </button>
                <AnimatePresence>
                  {speedOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      className="glass-strong absolute bottom-11 left-0 z-20 w-36 rounded-2xl p-1.5"
                    >
                      {SPEEDS.map((v) => (
                        <button
                          key={v}
                          onClick={() => {
                            setSpeed(v);
                            setSpeedOpen(false);
                          }}
                          className={cx(
                            "w-full rounded-xl px-3 py-1.5 text-left text-[13px]",
                            v === speed ? "accent-text font-semibold" : "hover:bg-[var(--panel-strong)]"
                          )}
                        >
                          {v}x
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="flex items-center gap-1.5">
                {!!track.videoId && (
                  <ToolButton label={videoMode ? "Switch to audio mode" : "Switch to video mode"} active={videoMode} onClick={() => void setVideoMode(!videoMode)}>
                    {videoMode ? <Music2 size={17} /> : <MonitorPlay size={17} />}
                  </ToolButton>
                )}
                <ToolButton
                  label="Equalizer"
                  active={eqOpen}
                  onClick={() => usePlayer.getState().set({ eqOpen: !eqOpen, queueOpen: false })}
                >
                  <SlidersHorizontal size={17} />
                </ToolButton>
                <ToolButton label="Sleep timer" active={!!sleepMode} onClick={() => useUi.getState().setSleepMenuOpen(true)}>
                  <Moon size={17} />
                </ToolButton>
                <ToolButton
                  label="Queue"
                  active={queueOpen}
                  onClick={() => usePlayer.getState().set({ queueOpen: !queueOpen, eqOpen: false })}
                >
                  <ListMusic size={17} />
                </ToolButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* queue + eq overlays */}
      <AnimatePresence>{queueOpen && <QueuePanel key="q" />}</AnimatePresence>
      <AnimatePresence>{eqOpen && <EqOverlay key="eq" />}</AnimatePresence>
    </motion.div>
  );
}

function ToolButton({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cx("glass grid h-10 w-10 place-items-center rounded-full transition-colors", active ? "accent-text" : "text-muted hover:text-[var(--text)]")}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- queue ---------------------------------- */
function QueuePanel() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const close = () => usePlayer.getState().set({ queueOpen: false });

  const cur = queue[index];

  const onReorder = (newOrder: Track[]) => {
    const curId = cur?.id;
    const newIdx = newOrder.findIndex((t) => t.id === curId);
    setQueue(newOrder, newIdx);
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 60 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 60 }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="glass-strong absolute top-0 right-0 bottom-0 z-20 flex w-full max-w-md flex-col md:top-4 md:right-4 md:bottom-4 md:rounded-3xl"
    >
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <h3 className="font-display text-[17px] font-bold">Queue</h3>
          <p className="text-muted-2 text-[12px]">{queue.length} tracks · drag to reorder</p>
        </div>
        <button aria-label="Close queue" onClick={close} className="text-muted grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--panel)] hover:text-[var(--text)]">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Reorder.Group axis="y" values={queue} onReorder={onReorder} className="space-y-0.5">
          {queue.map((t, i) => (
            <Reorder.Item
              key={t.id}
              value={t}
              className={cx(
                "group flex cursor-default items-center gap-2 rounded-xl px-2 py-2",
                i === index ? "bg-[var(--panel-strong)]" : "hover:bg-[var(--panel)]"
              )}
              style={{ listStyle: "none" }}
              whileDrag={{ scale: 1.02, boxShadow: "0 18px 40px -12px rgba(0,0,0,.6)" }}
            >
              <button aria-label="Play" className="shrink-0" onClick={() => i !== index && void playIndex(i)}>
                <img src={t.artwork} alt="" className="h-10 w-10 rounded-lg object-cover" />
              </button>
              <div className="min-w-0 flex-1" onClick={() => i !== index && void playIndex(i)}>
                <div className={cx("flex items-center gap-1.5 truncate text-[13.5px] font-medium", i === index && "accent-text")}>
                  {i === index && <LiveEq paused={!isPlaying} size={11} />}
                  <span className="truncate">{t.title}</span>
                </div>
                <div className="text-muted truncate text-[11.5px]">{t.artist}</div>
              </div>
              <span className="text-muted-2 text-[11px] tabular-nums">{formatTime(t.durationMs)}</span>
              {i !== index && (
                <button
                  aria-label="Remove from queue"
                  onClick={() => removeFromQueue(i)}
                  className="text-muted grid h-8 w-8 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <span className="text-muted-2 cursor-grab active:cursor-grabbing">
                <GripVertical size={16} />
              </span>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>
    </motion.aside>
  );
}

/* -------------------------------- equalizer -------------------------------- */
function EqOverlay() {
  const eqPreset = useSettings((s) => s.eqPreset);
  const eqGains = useSettings((s) => s.eqGains);
  const set = useSettings((s) => s.set);
  const close = () => usePlayer.getState().set({ eqOpen: false });

  const currentGains =
    eqPreset === "custom" ? eqGains : EQ_PRESETS[eqPreset]?.gains ?? [0, 0, 0, 0, 0];

  useEffect(() => {
    applySettings();
  }, [eqPreset, eqGains]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 60 }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="glass-strong absolute right-0 bottom-0 left-0 z-20 mx-auto w-full max-w-2xl rounded-t-3xl p-6 md:right-auto md:bottom-6 md:left-6 md:rounded-3xl"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-[17px] font-bold">Equalizer</h3>
          <p className="text-muted-2 text-[12px]">Real-time DSP · applied instantly</p>
        </div>
        <button aria-label="Close equalizer" onClick={close} className="text-muted grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--panel)] hover:text-[var(--text)]">
          <X size={18} />
        </button>
      </div>

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {Object.entries(EQ_PRESETS).map(([id, p]) => (
          <button
            key={id}
            onClick={() => set({ eqPreset: id })}
            className={cx(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-all",
              eqPreset === id ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-end justify-between gap-2 px-2">
        {EQ_BANDS.map((band, i) => (
          <div key={band} className="flex flex-col items-center gap-2">
            <span className="text-muted-2 text-[10px] font-semibold tabular-nums">
              {currentGains[i] > 0 ? `+${currentGains[i]}` : currentGains[i]}
            </span>
            <input
              type="range"
              className="v-slider"
              min={-12}
              max={12}
              step={1}
              value={currentGains[i]}
              aria-label={`${band} Hz`}
              onChange={(e) => {
                const nextGains = [...currentGains];
                nextGains[i] = Number(e.target.value);
                set({ eqPreset: "custom", eqGains: nextGains });
              }}
            />
            <span className="text-muted-2 text-[10.5px] tabular-nums">{band >= 1000 ? `${band / 1000}k` : band}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-[var(--border-soft)] pt-4">
        <div>
          <div className="text-[13.5px] font-semibold">Volume normalization</div>
          <div className="text-muted-2 text-[11.5px]">Keep loudness consistent between tracks</div>
        </div>
        <Toggle
          checked={useSettings((s) => s.normalization) ?? true}
          onChange={(v) => useSettings.getState().set({ normalization: v })}
        />
      </div>
    </motion.div>
  );
}
