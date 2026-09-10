"use client";

/** Sidify brand mark — neon "S" monogram fused with equalizer bars. */
export default function SidifyLogo({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      style={glow ? { filter: "drop-shadow(0 0 10px var(--glow))" } : undefined}
      aria-label="Sidify"
    >
      <defs>
        <linearGradient id="sdf-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14141f" />
          <stop offset="1" stopColor="#050509" />
        </linearGradient>
        <linearGradient id="sdf-neon" x1="16" y1="52" x2="48" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="59" height="59" rx="16" fill="url(#sdf-bg)" stroke="rgba(255,255,255,0.1)" />
      <text
        x="30"
        y="43"
        textAnchor="middle"
        fontSize="32"
        fontWeight="800"
        fill="url(#sdf-neon)"
        style={{ fontFamily: "var(--font-sora), sans-serif" }}
      >
        S
      </text>
      <g fill="url(#sdf-neon)">
        <rect x="24" y="42" width="3.4" height="10" rx="1.7" className="eq-bar" style={{ animationDelay: "0s" }} />
        <rect x="30.3" y="38" width="3.4" height="14" rx="1.7" className="eq-bar" style={{ animationDelay: "0.25s" }} />
        <rect x="36.6" y="44" width="3.4" height="8" rx="1.7" className="eq-bar" style={{ animationDelay: "0.5s" }} />
      </g>
    </svg>
  );
}

/** Small animated "now playing" equalizer indicator. */
export function LiveEq({ size = 16, paused = false }: { size?: number; paused?: boolean }) {
  const barW = size / 5.2;
  return (
    <div
      className={paused ? "eq-paused flex items-end gap-[2px]" : "flex items-end gap-[2px]"}
      style={{ height: size }}
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="eq-bar inline-block rounded-full accent-bg"
          style={{ width: barW, height: "100%", animationDelay: `${i * 0.22}s` }}
        />
      ))}
    </div>
  );
}
