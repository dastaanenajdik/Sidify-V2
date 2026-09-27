"use client";

/**
 * The one download affordance in the app.
 *
 * It owns three states — idle, in-flight, saved — so every surface (track row, full
 * player, downloads page) shows the same thing. While bytes are arriving the arrow is
 * replaced by a progress ring with the live percentage inside it, because "Downloading…"
 * with no number and no movement reads exactly like a download that has died.
 */

import { Check, Download, FileDown } from "lucide-react";
import type { Track } from "@/lib/types";
import { cx } from "@/lib/format";
import { downloadTrackFlow } from "@/lib/library";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";

function ProgressGlyph({ pct, size }: { pct: number; size: number }) {
  const r = 15;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size + 13, height: size + 13 }}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3.4" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          style={{ transition: "stroke-dasharray 200ms linear" }}
        />
      </svg>
      <span
        className="accent-text font-extrabold tabular-nums"
        style={{ fontSize: Math.max(8, Math.round(size * 0.62)) }}
      >
        {Math.round(clamped)}
      </span>
    </span>
  );
}

export default function DownloadButton({
  track,
  size = 15,
  toDevice = false,
  className,
  glyphClassName,
}: {
  track: Track;
  /** Icon size in px — the ring grows around it. */
  size?: number;
  /** "Save to device" (a real file) instead of the offline cache. */
  toDevice?: boolean;
  className?: string;
  glyphClassName?: string;
}) {
  const downloaded = usePlayer((s) => !!s.downloadedIds[track.id]);
  const pct = useUi((s) => s.downloadProgress[track.id]);
  const busy = pct != null;
  const Idle = toDevice ? FileDown : Download;

  return (
    <button
      aria-label={
        busy ? `Downloading ${Math.round(pct ?? 0)}%` : toDevice ? "Save to device" : downloaded ? "Downloaded" : "Download"
      }
      title={busy ? `Downloading… ${Math.round(pct ?? 0)}%` : toDevice ? "Save to device" : downloaded ? "Saved offline" : "Download"}
      onClick={(e) => {
        e.stopPropagation();
        void downloadTrackFlow(track, toDevice ? { toDevice: true } : undefined);
      }}
      className={cx(
        "relative grid place-items-center rounded-full transition-all",
        // The accent means "this is saved offline" — on the Save-to-device variant the
        // icon is an action, not a state, so it stays neutral.
        !toDevice && downloaded && !busy && "accent-text",
        (toDevice || !downloaded) && !busy && "text-muted hover:text-[var(--text)]",
        // A hover-only button must stay visible while it is working.
        busy && "opacity-100 md:opacity-100",
        className
      )}
    >
      {busy ? (
        <ProgressGlyph pct={pct ?? 0} size={size} />
      ) : (
        <Idle size={size} className={glyphClassName} />
      )}
    </button>
  );
}
