"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Crosshair, FileText } from "lucide-react";
import { activeLineIndex, type LyricLine } from "@/lib/lyrics";
import { seekTo } from "@/lib/audioEngine";
import { cx } from "@/lib/format";
import CopyLyricsButton from "./CopyLyricsButton";

/* ------------------------------------------------------------------ */
/*  Shared lyrics renderer.                                            */
/*                                                                     */
/*  Two views over the same payload:                                   */
/*   - "static" : plain text, exactly like the original panel          */
/*   - "synced" : LRC lines lit up one at a time against the media     */
/*                clock, auto-following the current line (Spotify-ish) */
/*                                                                     */
/*  Used by the full player's lyrics panel and by Library → Lyrics.    */
/* ------------------------------------------------------------------ */

export type LyricsMode = "static" | "synced";

/** A usable synced view needs at least two timestamps. */
export function lyricsAreSynced(lines: LyricLine[] | undefined): boolean {
  return Array.isArray(lines) && lines.length >= 2;
}

/** Small segmented switch. Synced stays disabled when the provider sent no timestamps. */
export function LyricsModeToggle({
  mode,
  syncedAvailable,
  onChange,
}: {
  mode: LyricsMode;
  syncedAvailable: boolean;
  onChange: (mode: LyricsMode) => void;
}) {
  const options: { id: LyricsMode; label: string; hint: string }[] = [
    { id: "static", label: "Static", hint: "Plain lyrics text" },
    {
      id: "synced",
      label: "Synced",
      hint: syncedAvailable ? "Lines light up as the song plays" : "Timed lyrics are not available for this song",
    },
  ];
  return (
    <div
      role="tablist"
      aria-label="Lyrics view"
      className="no-scrollbar inline-flex shrink-0 items-center gap-0.5 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--panel)] p-0.5"
    >
      {options.map((option) => {
        const active = mode === option.id;
        const disabled = option.id === "synced" && !syncedAvailable;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.hint}
            disabled={disabled}
            onClick={() => !disabled && onChange(option.id)}
            className={cx(
              "relative rounded-full px-3 py-1 text-[11px] font-bold tracking-wide transition-colors",
              active ? "text-black" : disabled ? "text-muted-2 cursor-not-allowed opacity-60" : "text-muted hover:text-[var(--text)]"
            )}
          >
            {active && (
              <motion.span
                layoutId="lyrics-mode-pill"
                transition={{ type: "spring", damping: 30, stiffness: 420 }}
                className="accent-bg absolute inset-0 rounded-full"
                style={{ boxShadow: "0 0 14px -2px var(--glow)" }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function LyricsView({
  lyrics,
  lines,
  mode,
  positionMs = 0,
  source = "",
  className,
  listClassName,
}: {
  /** Plain text — the static view and the copy button both use this. */
  lyrics: string | null;
  /** Timed lines from LRC (may be empty). */
  lines: LyricLine[];
  mode: LyricsMode;
  /** Media-time position in ms; ignored in static mode. */
  positionMs?: number;
  source?: string;
  /** Height/flex classes for the outer block. */
  className?: string;
  /** Extra classes for the scrolling list. */
  listClassName?: string;
}) {
  const synced = mode === "synced" && lyricsAreSynced(lines);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  // Auto-follow pauses while the user reads elsewhere and resumes on a line change.
  const autoFollow = useRef(true);
  const userScrolledUntil = useRef(0);
  const [followPaused, setFollowPaused] = useState(false);

  // Binary search is cheap, but the parent clock ticks at 60 fps — quantise to ~12 Hz
  // so the component only re-renders when the highlight can actually move.
  const bucket = synced ? Math.round(positionMs / 80) : 0;
  const active = useMemo(() => (synced ? activeLineIndex(lines, bucket * 80) : -1), [synced, lines, bucket]);

  // Fresh payload (track change / manual search) or a switch into the synced list:
  // resume following and snap straight to wherever playback currently is — no
  // animation on a hard jump.
  useEffect(() => {
    autoFollow.current = true;
    userScrolledUntil.current = 0;
    // Guarded no-op unless the user had scrolled away from the current line.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (followPaused) setFollowPaused(false);
    const element = scrollRef.current;
    if (!synced || !element) return;
    element.style.scrollBehavior = "auto";
    centerLine(element, rowRefs.current[Math.max(0, activeLineIndex(lines, positionMs))]);
    element.style.scrollBehavior = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, synced]);

  // Follow the active line while auto-follow is on.
  useEffect(() => {
    if (!synced || active < 0) return;
    if (!autoFollow.current || performance.now() < userScrolledUntil.current) return;
    const element = scrollRef.current;
    const row = rowRefs.current[active];
    if (!element || !row) return;
    const distance = Math.abs(row.offsetTop - element.scrollTop - element.clientHeight / 2 + row.offsetHeight / 2);
    // Long seeks jump instantly; nearby lines glide.
    element.style.scrollBehavior = distance > 600 ? "auto" : "smooth";
    centerLine(element, row);
    element.style.scrollBehavior = "";
  }, [active, synced]);

  function noteUserScroll() {
    userScrolledUntil.current = performance.now() + 5000;
    autoFollow.current = false;
    setFollowPaused(true);
  }

  function jumpToCurrent() {
    autoFollow.current = true;
    userScrolledUntil.current = 0;
    setFollowPaused(false);
    const element = scrollRef.current;
    if (!element) return;
    element.style.scrollBehavior = "smooth";
    centerLine(element, rowRefs.current[Math.max(0, active)]);
    element.style.scrollBehavior = "";
  }

  const copyable = lyrics?.trim() ? lyrics : lines.map((l) => l.text).join("\n");

  return (
    <div className={cx("relative flex min-h-0 flex-col", className)}>
      {synced ? (
        <div
          ref={scrollRef}
          onWheel={noteUserScroll}
          onTouchMove={noteUserScroll}
          onScroll={() => {
            if (performance.now() > userScrolledUntil.current && autoFollow.current === false) noteUserScroll();
          }}
          className={cx(
            "lyrics-scroll no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-[34%] pb-[46%]",
            listClassName
          )}
        >
          {lines.map((line, i) => {
            const state = active < 0 ? "next" : i < active ? "past" : i === active ? "active" : "next";
            return (
              <p
                key={`${line.startMs}-${i}`}
                ref={(node) => {
                  rowRefs.current[i] = node;
                }}
                data-state={state}
                onClick={() => seekTo(line.startMs)}
                title="Play from this line"
                className="synced-line cursor-pointer"
              >
                {line.text}
              </p>
            );
          })}
        </div>
      ) : (
        <div className={cx("lyrics-scroll no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-6", listClassName)}>
          <p className="whitespace-pre-wrap text-[15px] leading-8 tracking-[0.01em]">{lyrics}</p>
        </div>
      )}

      {synced && followPaused && active >= 0 && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={jumpToCurrent}
          className="accent-text glass-strong absolute bottom-4 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold shadow-lg"
        >
          <Crosshair size={12} /> Current line
        </motion.button>
      )}

      {copyable.trim() && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-soft)] px-4 py-2">
          <span className="text-muted-2 flex min-w-0 items-center gap-1.5 text-[10.5px]">
            {synced ? <Crosshair size={11} className="shrink-0" /> : <FileText size={11} className="shrink-0" />}
            <span className="truncate">
              {synced ? "Synced · tap a line to seek" : "Static"}
              {source ? ` · via ${source}` : ""}
            </span>
          </span>
          <CopyLyricsButton lyrics={copyable} label="Copy" />
        </div>
      )}
    </div>
  );
}

function centerLine(element: HTMLElement, row: HTMLElement | null) {
  if (!row) return;
  element.scrollTop = Math.max(0, row.offsetTop - element.clientHeight / 2 + row.offsetHeight / 2);
}
