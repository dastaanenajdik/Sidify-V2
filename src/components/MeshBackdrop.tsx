"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/store/settings";
import { dim, tune, usePalette, type Palette } from "@/lib/palette";
import { cx } from "@/lib/format";

/**
 * The Now Playing backdrop: four luminous blobs sampled from the artwork,
 * blurred into one mesh. Colours crossfade over ~1.4s on a track change and
 * the blobs drift a little — then come to rest, so a full-screen blur isn't
 * redrawn forever for motion nobody is watching.
 */

const ANCHORS: [number, number][] = [
  [0.2, 0.25],
  [0.8, 0.2],
  [0.75, 0.8],
  [0.25, 0.75],
];
const SPEEDS = [1, -0.7, 0.85, -1.15];
/** "Colour from artwork" switched off: a quiet graphite mesh instead. */
const NEUTRAL: Palette = ["#3a3a40", "#2a2a30", "#45454c", "#26262b"];
const DRIFT = Math.PI * 0.45;

export default function MeshBackdrop({
  artwork,
  palette: given,
  className,
  blur = 64,
  scrim = true,
  driftKey,
}: {
  artwork?: string | null;
  palette?: Palette;
  className?: string;
  blur?: number;
  scrim?: boolean;
  /** Changing this nudges the blobs into a new resting place. */
  driftKey?: string | number | null;
}) {
  const dynamic = useSettings((s) => s.dynamicColor);
  const reduce = useSettings((s) => s.reduceMotion);
  const sampled = usePalette(artwork, dynamic && !given);
  const raw = given ?? (dynamic ? sampled : NEUTRAL);
  const colors = given || dynamic ? raw.map(tune) : raw;
  const base = dim(colors[0]);

  const [phase, setPhase] = useState(0);
  const lastKey = useRef(driftKey);
  useEffect(() => {
    if (reduce || driftKey === lastKey.current) return;
    lastKey.current = driftKey;
    const id = requestAnimationFrame(() => setPhase((p) => p + DRIFT));
    return () => cancelAnimationFrame(id);
  }, [driftKey, reduce]);

  return (
    <div className={cx("mesh", className)} style={{ backgroundColor: base, transition: "background-color 1.4s ease", containerType: "size" }}>
      <div className="mesh-layer" style={{ ["--mesh-blur" as string]: `${blur}px` }}>
        {colors.map((c, i) => {
          const [ax, ay] = ANCHORS[i];
          const dx = 0.16 * Math.cos(phase * SPEEDS[i] + i * 1.7);
          const dy = 0.16 * Math.sin(phase * SPEEDS[i] * 0.9 + i * 2.3);
          return (
            <div
              key={i}
              className="mesh-blob"
              style={{
                left: `${ax * 100}%`,
                top: `${ay * 100}%`,
                width: "124cqmax",
                height: "124cqmax",
                marginLeft: "-62cqmax",
                marginTop: "-62cqmax",
                backgroundColor: c,
                opacity: 0.85,
                transform: `translate(${dx * 100}cqw, ${dy * 100}cqh)`,
                WebkitMaskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 45%, transparent 100%)",
                maskImage: "radial-gradient(closest-side, #000 0%, rgba(0,0,0,.6) 45%, transparent 100%)",
                transition: reduce ? "none" : undefined,
              }}
            />
          );
        })}
      </div>
      {scrim && <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.38))" }} />}
    </div>
  );
}
