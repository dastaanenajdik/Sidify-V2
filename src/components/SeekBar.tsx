"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/store/player";
import { seekTo } from "@/lib/audioEngine";
import { formatSecs } from "@/lib/format";

export default function SeekBar({ showTimes = true, className }: { showTimes?: boolean; className?: string }) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const [scrub, setScrub] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const dur = Math.max(1, durationMs / 1000);
  const pos = scrub ?? positionMs / 1000;
  const fill = Math.min(100, (pos / dur) * 100);

  useEffect(() => {
    if (ref.current) ref.current.style.setProperty("--fill", `${fill}%`);
  }, [fill]);

  return (
    <div className={className}>
      <input
        ref={ref}
        type="range"
        aria-label="Seek"
        className="th-slider w-full"
        min={0}
        max={dur}
        step={0.1}
        value={pos}
        onPointerDown={() => setScrub(positionMs / 1000)}
        onChange={(e) => setScrub(Number(e.target.value))}
        onPointerUp={() => {
          if (scrub != null) seekTo(scrub * 1000);
          setScrub(null);
        }}
        onKeyUp={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") setScrub(null);
        }}
      />
      {showTimes && (
        <div className="text-muted-2 mt-0.5 flex justify-between text-[11px] tabular-nums">
          <span>{formatSecs(pos)}</span>
          <span>-{formatSecs(Math.max(0, dur - pos))}</span>
        </div>
      )}
    </div>
  );
}
