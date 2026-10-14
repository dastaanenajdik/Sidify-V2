/**
 * Sidify's own glyphs — the solid, rounded shapes the transport and the tab bar
 * use. Everything else comes from lucide-react.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export function PlayGlyph(p: P) {
  return (
    <Svg {...p}>
      <path
        fill="currentColor"
        d="M7.2 4.6v14.8c0 .95 1.03 1.54 1.85 1.06l12.1-7.4a1.24 1.24 0 0 0 0-2.12L9.05 3.54C8.23 3.06 7.2 3.65 7.2 4.6Z"
      />
    </Svg>
  );
}

export function PauseGlyph(p: P) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="3.8" width="4.6" height="16.4" rx="1.3" fill="currentColor" />
      <rect x="13.9" y="3.8" width="4.6" height="16.4" rx="1.3" fill="currentColor" />
    </Svg>
  );
}

export function ForwardGlyph(p: P) {
  return (
    <Svg {...p}>
      <path
        fill="currentColor"
        d="M1.6 6.3v11.4c0 .82.92 1.3 1.6.84l8.05-5.7a1.03 1.03 0 0 0 0-1.68L3.2 5.46c-.68-.46-1.6.02-1.6.84Zm10.6 0v11.4c0 .82.92 1.3 1.6.84l8.05-5.7a1.03 1.03 0 0 0 0-1.68L13.8 5.46c-.68-.46-1.6.02-1.6.84Z"
      />
    </Svg>
  );
}

export function BackwardGlyph(p: P) {
  return (
    <Svg {...p}>
      <g transform="translate(24 0) scale(-1 1)">
        <path
          fill="currentColor"
          d="M1.6 6.3v11.4c0 .82.92 1.3 1.6.84l8.05-5.7a1.03 1.03 0 0 0 0-1.68L3.2 5.46c-.68-.46-1.6.02-1.6.84Zm10.6 0v11.4c0 .82.92 1.3 1.6.84l8.05-5.7a1.03 1.03 0 0 0 0-1.68L13.8 5.46c-.68-.46-1.6.02-1.6.84Z"
        />
      </g>
    </Svg>
  );
}

/* ---------------------------------- tabs ---------------------------------- */

export function HomeGlyph(p: P) {
  return (
    <Svg {...p}>
      <path
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M4 10.4 11.25 4.3a1.15 1.15 0 0 1 1.5 0L20 10.4v9.1c0 .55-.45 1-1 1h-4.1v-5.6a.9.9 0 0 0-.9-.9h-4a.9.9 0 0 0-.9.9v5.6H5c-.55 0-1-.45-1-1z"
      />
    </Svg>
  );
}

export function ExploreGlyph(p: P) {
  return (
    <Svg {...p}>
      <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.1" fill="currentColor" />
      <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.1" fill="currentColor" />
      <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.1" fill="currentColor" />
      <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.1" fill="currentColor" />
    </Svg>
  );
}

export function LibraryGlyph(p: P) {
  return (
    <Svg {...p}>
      <rect x="7.4" y="2.6" width="9.2" height="1.8" rx=".9" fill="currentColor" opacity=".5" />
      <rect x="5" y="5.6" width="14" height="2" rx="1" fill="currentColor" opacity=".75" />
      <rect x="2.8" y="9" width="18.4" height="12.4" rx="2.6" fill="currentColor" />
    </Svg>
  );
}

export function SearchGlyph(p: P) {
  return (
    <Svg {...p}>
      <circle cx="10.6" cy="10.6" r="6.6" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="m15.6 15.6 5 5" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" />
    </Svg>
  );
}

export function PeopleGlyph(p: P) {
  return (
    <Svg {...p}>
      <circle cx="16.4" cy="7.6" r="2.9" fill="currentColor" opacity=".72" />
      <path
        fill="currentColor"
        opacity=".72"
        d="M16.4 11.6c-1.15 0-2.2.27-3.08.76a6.1 6.1 0 0 1 2.68 4.84v1.3h5.2c.55 0 .9-.42.86-.96-.24-3.3-2.5-5.94-5.66-5.94Z"
      />
      <circle cx="8.8" cy="7.2" r="3.5" fill="currentColor" />
      <path
        fill="currentColor"
        d="M8.8 12.1c-3.6 0-6.32 2.84-6.6 6.4-.04.56.4 1 .96 1h11.28c.56 0 1-.44.96-1-.28-3.56-3-6.4-6.6-6.4Z"
      />
    </Svg>
  );
}

/* ------------------------------ player chrome ----------------------------- */

/** Speech bubble with quote marks — the lyrics toggle. */
export function LyricsGlyph({ filled, ...p }: P & { filled?: boolean }) {
  return (
    <Svg {...p}>
      <path
        d="M12 3.6c-5 0-9 3.2-9 7.3 0 2.3 1.3 4.4 3.3 5.7l-.6 3.2c-.1.5.45.86.87.58l3.62-2.42c.58.1 1.18.15 1.81.15 5 0 9-3.2 9-7.3S17 3.6 12 3.6Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M8.6 9.4c-.8 0-1.4.6-1.4 1.35 0 .7.55 1.27 1.25 1.3-.1.6-.45 1.06-1.02 1.35M13.4 9.4c-.8 0-1.4.6-1.4 1.35 0 .7.55 1.27 1.25 1.3-.1.6-.45 1.06-1.02 1.35"
        fill="none"
        stroke={filled ? "var(--qb, #000)" : "currentColor"}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Three bullets and lines — the queue toggle. */
export function QueueGlyph(p: P) {
  return (
    <Svg {...p}>
      <circle cx="4.6" cy="6.5" r="1.5" fill="currentColor" />
      <circle cx="4.6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="4.6" cy="17.5" r="1.5" fill="currentColor" />
      <path d="M9 6.5h11M9 12h11M9 17.5h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </Svg>
  );
}

/** AutoPlay's lemniscate. */
export function InfinityGlyph(p: P) {
  return (
    <Svg {...p}>
      <path
        d="M12 12c-1.7-2.3-3.3-3.6-5.2-3.6a3.6 3.6 0 0 0 0 7.2c1.9 0 3.5-1.3 5.2-3.6Zm0 0c1.7 2.3 3.3 3.6 5.2 3.6a3.6 3.6 0 0 0 0-7.2c-1.9 0-3.5 1.3-5.2 3.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Headphones — the output button in the player capsule. */
export function OutputGlyph(p: P) {
  return (
    <Svg {...p}>
      <path
        d="M4 14.5V12a8 8 0 0 1 16 0v2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <rect x="3" y="13.4" width="4.6" height="7" rx="1.8" fill="currentColor" />
      <rect x="16.4" y="13.4" width="4.6" height="7" rx="1.8" fill="currentColor" />
    </Svg>
  );
}

/** The three bars that mark a playing row (animated via CSS). */
export function PlayingBars({ paused, size = 12, className }: { paused?: boolean; size?: number; className?: string }) {
  return (
    <span
      className={`playing-bars ${paused ? "paused" : ""} ${className ?? ""}`}
      style={{ ["--pb-size" as string]: `${size}px` }}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
