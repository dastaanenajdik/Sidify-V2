"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useSettings } from "@/store/settings";
import { dim, tune, usePalette, type Palette } from "@/lib/palette";
import { cx } from "@/lib/format";

/**
 * The Now Playing backdrop: four luminous radial-gradient blobs sampled from
 * the artwork and blended into one velvety mesh — diffused natively via smooth
 * radial gradients so the GPU never has to recompute a giant 90px Gaussian blur.
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

function MeshBackdrop({
  artwork,
  palette: given,
  className,
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
    <div className={cx("mesh", className)} style={{ backgroundColor: base, transition: "background-color 0.9s ease", containerType: "size" }}>
      <div className="mesh-layer">
        {colors.map((c, i) => {
          const [ax, ay] = ANCHORS[i];
          const dx = 0.14 * Math.cos(phase * SPEEDS[i] + i * 1.7);
          const dy = 0.14 * Math.sin(phase * SPEEDS[i] * 0.9 + i * 2.3);
          return (
            <div
              key={i}
              className="mesh-blob"
              style={{
                left: `${ax * 100}%`,
                top: `${ay * 100}%`,
                width: "136cqmax",
                height: "136cqmax",
                marginLeft: "-68cqmax",
                marginTop: "-68cqmax",
                background: `radial-gradient(closest-side, ${c} 0%, transparent 100%)`,
                opacity: 0.78,
                transform: `translate3d(${dx * 100}cqw, ${dy * 100}cqh, 0)`,
                transition: reduce ? "none" : "transform 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          );
        })}
      </div>
      {scrim && <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.10), rgba(0,0,0,.38))" }} />}
    </div>
  );
}

export default memo(MeshBackdrop);

