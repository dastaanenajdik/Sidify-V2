"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, FlaskConical, Gauge, Pause, Play, RotateCcw } from "lucide-react";
import { parseLrc } from "@/lib/lyrics";
import { useSmoothPosition } from "@/lib/lyricsClient";
import { usePlayer } from "@/store/player";
import LyricsView, { LyricsModeToggle, type LyricsMode } from "@/components/LyricsView";
import SeekBar from "@/components/SeekBar";
import { DEMO_LRC, DEMO_TRACK } from "./demoTrack";

/* ------------------------------------------------------------------ */
/*  Developer playground for the synced (LRC) lyrics view.             */
/*                                                                     */
/*  Nothing here talks to YouTube: the media clock in the player store  */
/*  is driven by a timer instead, so the exact code path that lights up */
/*  lines during real playback (useSmoothPosition → activeLineIndex →   */
/*  LyricsView) can be inspected without a stream.                     */
/*                                                                     */
/*  Not linked from the app shell. Remove with:                        */
/*    rm -r src/app/dev                                                */
/* ------------------------------------------------------------------ */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function LyricsSyncDevPage() {
  const lines = parseLrc(DEMO_LRC);
  const set = usePlayer((s) => s.set);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const positionMs = useSmoothPosition();
  const [mode, setMode] = useState<LyricsMode>("synced");
  const [speed, setSpeedValue] = useState(1);
  const posRef = useRef(0);

  useEffect(() => {
    posRef.current = positionMs;
  }, [positionMs]);

  // Seed the transport with the demo track so the clock/duration are meaningful.
  useEffect(() => {
    set({ positionMs: 0, durationMs: DEMO_TRACK.durationMs, speed: 1, isPlaying: false });
    return () => set({ isPlaying: false, positionMs: 0, durationMs: 0 });
  }, [set]);

  // Simulated media clock: same store fields the audio engine writes.
  useEffect(() => {
    const id = setInterval(() => {
      const nextValue = Math.min(DEMO_TRACK.durationMs, posRef.current + 250 * speed);
      posRef.current = nextValue;
      set({ positionMs: nextValue });
    }, 250);
    return () => clearInterval(id);
  }, [speed, set]);

  const toggle = () => {
    const playing = !usePlayer.getState().isPlaying;
    if (playing && posRef.current >= DEMO_TRACK.durationMs - 400) posRef.current = 0;
    set({ isPlaying: playing, positionMs: posRef.current });
  };

  const seekBy = (deltaMs: number) => {
    const value = Math.max(0, Math.min(DEMO_TRACK.durationMs, posRef.current + deltaMs));
    posRef.current = value;
    set({ positionMs: value });
  };

  const changeSpeed = (value: number) => {
    setSpeedValue(value);
    set({ speed: value });
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-28 md:px-7">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/library?tab=lyrics" className="text-muted glass grid h-10 w-10 place-items-center rounded-full hover:text-[var(--text)]" aria-label="Back to library">
          <ChevronLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-tight md:text-[28px]">
            <FlaskConical size={20} className="accent-text mr-2 inline-block align-[-3px]" />
            Lyrics sync playground
          </h1>
          <p className="text-muted text-[13px]">
            Dev-only page — playback is simulated, so the synced view can be checked without streaming a song.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* transport */}
        <div className="glass h-fit rounded-3xl p-5">
          <div className="flex items-center gap-4">
            <div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, var(--accent), #7c3aed 70%)" }}
            >
              <Play size={26} className="translate-x-[2px] text-black" fill="currentColor" strokeWidth={0} />
            </div>
            <div className="min-w-0">
              <div className="text-[10.5px] font-bold tracking-[0.2em] uppercase text-muted">Demo track</div>
              <div className="font-display truncate text-[17px] font-bold">{DEMO_TRACK.title}</div>
              <div className="text-muted truncate text-[13px]">{DEMO_TRACK.artist}</div>
            </div>
          </div>

          <div className="mt-5">
            <SeekBar />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button onClick={() => seekBy(-10_000)} className="text-muted grid h-10 w-10 place-items-center rounded-full hover:bg-[var(--panel)] hover:text-[var(--text)]" aria-label="Back 10 seconds">
              <RotateCcw size={17} />
            </button>
            <button
              onClick={toggle}
              className="accent-bg grid h-14 w-14 place-items-center rounded-full text-black transition-transform hover:scale-105"
              aria-label={isPlaying ? "Pause" : "Play"}
              style={{ boxShadow: "0 14px 34px -10px var(--glow)" }}
            >
              {isPlaying ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} className="translate-x-[2px]" />}
            </button>
            <div className="relative">
              <Gauge size={15} className="text-muted-2 pointer-events-none absolute top-1/2 left-2 -translate-y-1/2" />
              <select
                value={speed}
                onChange={(event) => changeSpeed(Number(event.target.value))}
                aria-label="Playback speed"
                className="glass text-muted h-10 cursor-pointer rounded-full pr-3 pl-7 text-[12px] font-semibold outline-none"
              >
                {SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}x
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 space-y-2 border-t border-[var(--border-soft)] pt-4">
            <button
              onClick={() => seekBy(-5_000)}
              className="hover-panel w-full rounded-xl px-3 py-2 text-left text-[12.5px] font-semibold"
            >
              ↺ 5 s — check that the highlight re-syncs after a seek
            </button>
            <button
              onClick={() => seekBy(30_000)}
              className="hover-panel w-full rounded-xl px-3 py-2 text-left text-[12.5px] font-semibold"
            >
              ↻ 30 s — long jump (auto-scroll snaps instead of gliding)
            </button>
            <p className="text-muted-2 px-1 pt-1 text-[11.5px] leading-5">
              Try: scroll away while it plays → the <span className="accent-text font-semibold">Current line</span> pill appears;
              tap a lyric line → the clock seeks there; change speed → the clock follows media time, not wall time.
            </p>
          </div>
        </div>

        {/* lyrics */}
        <div className="glass overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="min-w-0">
              <div className="accent-text text-[10px] font-bold tracking-[0.2em] uppercase">{lines.length} timed lines</div>
              <div className="font-display truncate text-[16px] font-bold">Lyrics</div>
            </div>
            <LyricsModeToggle mode={mode} syncedAvailable={lines.length >= 2} onChange={setMode} />
          </div>
          <LyricsView
            lyrics={lines.map((l) => l.text).join("\n")}
            lines={lines}
            mode={mode}
            positionMs={positionMs}
            source="demo fixture"
            className="h-[62vh] min-h-[380px]"
            listClassName="px-6"
          />
        </div>
      </div>
    </div>
  );
}
