"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, FlaskConical, Pause, Play, RotateCcw } from "lucide-react";
import { parseLrc } from "@/lib/lyrics";
import { useSmoothPosition } from "@/lib/lyricsClient";
import { usePlayer } from "@/store/player";
import { SyncedLyrics } from "@/components/player/LyricsPane";
import MeshBackdrop from "@/components/MeshBackdrop";
import { Chips, IconButton, Range } from "@/components/ui";
import { formatTime } from "@/lib/format";
import { DEMO_LRC, DEMO_TRACK } from "./demoTrack";

/* ------------------------------------------------------------------ */
/*  Developer playground for the synced (LRC) lyrics view.             */
/*                                                                     */
/*  Nothing here talks to YouTube: the media clock in the player store  */
/*  is driven by a timer instead, so the exact code path that lights up */
/*  lines during real playback (useSmoothPosition → activeLineIndex →   */
/*  SyncedLyrics) can be inspected without a stream.                   */
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
      if (!usePlayer.getState().isPlaying) return;
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

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-4 desk:px-8 desk:pt-7">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/library/lyrics" className="grid h-9 w-9 place-items-center rounded-full bg-fill hover:bg-fill-2" aria-label="Back">
          <ChevronLeft size={18} />
        </Link>
        <div>
          <h1 className="t-title flex items-center gap-2">
            <FlaskConical size={18} className="text-playing" /> Lyrics sync playground
          </h1>
          <p className="text-[13px] text-fg-2">Dev-only — playback is simulated, so the synced view can be checked without streaming.</p>
        </div>
      </div>

      <div className="relative h-[62vh] min-h-[380px] overflow-hidden rounded-[18px] text-white">
        <MeshBackdrop palette={["#3a1c71", "#d76d77", "#2b5876", "#ffaf7b"]} />
        <div className="relative flex h-full flex-col px-6 py-4">
          <SyncedLyrics lines={lines} offset={0} fontSize={30} onArt reduce={false} selecting={false} picked={[]} onPick={() => {}} />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Range
          label="Seek"
          value={positionMs}
          max={DEMO_TRACK.durationMs}
          step={250}
          onChange={(v) => {
            posRef.current = v;
            set({ positionMs: v });
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <IconButton label={isPlaying ? "Pause" : "Play"} tone="fill" size={40} onClick={toggle}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <IconButton
            label="Restart"
            tone="fill"
            size={40}
            onClick={() => {
              posRef.current = 0;
              set({ positionMs: 0 });
            }}
          >
            <RotateCcw size={17} />
          </IconButton>
          <span className="text-[13px] text-fg-2 tabular-nums">
            {formatTime(positionMs)} / {formatTime(DEMO_TRACK.durationMs)}
          </span>
          <Chips
            className="ml-auto"
            size="sm"
            value={String(speed)}
            options={SPEEDS.map((v) => ({ id: String(v), label: `${v}×` }))}
            onChange={(v) => {
              setSpeedValue(Number(v));
              set({ speed: Number(v) });
            }}
          />
        </div>
      </div>
    </div>
  );
}
