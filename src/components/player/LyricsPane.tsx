"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Languages, Minus, Plus, Search, Share, Timer } from "lucide-react";
import type { Track } from "@/lib/types";
import { activeLineIndex, type LyricLine } from "@/lib/lyrics";
import { advanceMediaClock, needsResync, useLyricsLookup } from "@/lib/lyricsClient";
import { getLyricsOffset, setLyricsOffset } from "@/lib/lyricsPrefs";
import { copyText } from "@/lib/clipboard";
import { seekTo } from "@/lib/audioEngine";
import { usePlayer } from "@/store/player";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";

/**
 * Lyrics, Apple-Music style: big bold lines, the sung line bright with a soft
 * wipe across it, the rest dimmer the further they are.
 * The list leads the music a little so the next line is already in place, a
 * tap on a line seeks to it, and scrolling by hand pauses follow briefly.
 */

type Variant = "player" | "panel" | "page";

const FALLOFF_ALPHA = [1, 0.8, 0.7, 0.58, 0.46];
const SCROLL_LEAD_MS = 420;

const SIZES: Record<Variant, Record<"s" | "m" | "l", number>> = {
  player: { s: 24, m: 30, l: 36 },
  panel: { s: 20, m: 24, l: 28 },
  page: { s: 22, m: 28, l: 34 },
};

/** The listener's own language for "Translate" (English when the browser says nothing). */
function translateTarget(): string {
  if (typeof navigator === "undefined") return "en";
  return (navigator.language || "en").split("-")[0] || "en";
}

export function lyricsAreSynced(lines: LyricLine[] | undefined): boolean {
  return Array.isArray(lines) && lines.length >= 2;
}

export default function LyricsPane({
  track,
  variant = "player",
  className,
  allowSynced = true,
  dense = false,
}: {
  track: Track;
  variant?: Variant;
  className?: string;
  /** Timed lines only make sense against the song that is actually playing. */
  allowSynced?: boolean;
  /** Narrow column (the desktop side panel): smaller type, same styling. */
  dense?: boolean;
}) {
  const { loading, started, lyrics, lines, source, instrumental, message, search, retry } = useLyricsLookup(
    track.title,
    track.artist,
    track.durationMs
  );
  const preferSynced = useSettings((s) => s.lyricsSynced);
  const size = useSettings((s) => s.lyricsSize);
  const reduce = useSettings((s) => s.reduceMotion);
  const [mode, setMode] = useState<"synced" | "static" | null>(null);
  const [offset, setOffset] = useState(() => (typeof window === "undefined" ? 0 : getLyricsOffset(track.id)));
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [timingOpen, setTimingOpen] = useState(false);
  /** In-page translation (via /api/translate): translated lines for one view, never a new tab. */
  // Scoped to a track id: a new song automatically starts from the original words.
  const [translation, setTranslation] = useState<{ lines: string[]; target: string; kind: "synced" | "plain"; trackId: string } | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const onArt = variant === "player";
  const fontSize = SIZES[dense ? "panel" : variant][size];

  const hasSync = allowSynced && lyricsAreSynced(lines);
  const synced = hasSync && (mode ? mode === "synced" : preferSynced);
  const plainLines = useMemo(() => {
    const text = lyrics?.trim() ? lyrics : lines.map((l) => l.text).join("\n");
    return text.split("\n");
  }, [lyrics, lines]);
  const viewKind: "synced" | "plain" = synced ? "synced" : "plain";
  const activeTranslation = translation && translation.kind === viewKind && translation.trackId === track.id ? translation : null;
  const showingTranslated = showTranslated && !!activeTranslation;
  const displayLines = useMemo(
    () =>
      showingTranslated && activeTranslation
        ? lines.map((l, i) => ({ ...l, text: activeTranslation.lines[i] ?? l.text }))
        : lines,
    [lines, showingTranslated, activeTranslation]
  );
  const displayPlainLines = showingTranslated && activeTranslation ? activeTranslation.lines : plainLines;
  const shareLines = synced ? displayLines.map((l) => l.text) : displayPlainLines;

  /** Translate the words on screen, right here — no new tab, timing preserved. */
  const toggleTranslate = async () => {
    if (translating) return;
    const target = translateTarget();
    if (activeTranslation && activeTranslation.target === target) {
      setShowTranslated((v) => !v);
      return;
    }
    const sourceLines = synced ? lines.map((l) => l.text) : plainLines;
    if (!sourceLines.some((l) => l.trim())) return;
    setTranslating(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines: sourceLines, target }),
      });
      const data = (await res.json()) as { success?: boolean; lines?: string[]; message?: string };
      if (!res.ok || !data.success || !Array.isArray(data.lines)) throw new Error(data.message || "translate failed");
      setTranslation({ lines: data.lines, target, kind: viewKind, trackId: track.id });
      setShowTranslated(true);
    } catch {
      useUi.getState().pushToast({ title: "Couldn't translate lyrics", desc: "Try again in a moment", kind: "warn" });
    } finally {
      setTranslating(false);
    }
  };

  const changeOffset = (delta: number) => {
    const next = Math.round((offset + delta) / 100) * 100;
    setOffset(next);
    setLyricsOffset(track.id, next);
  };

  const tone = onArt ? "text-white/60 hover:text-white" : "text-fg-2 hover:text-fg";

  if (loading || !started) return <LyricsSkeleton onArt={onArt} className={className} />;

  if (!lines.length && !lyrics?.trim()) {
    return (
      <NotFound
        onArt={onArt}
        className={className}
        instrumental={instrumental}
        message={message}
        track={track}
        onSearch={search}
        onRetry={retry}
      />
    );
  }

  return (
    <div className={cx("relative flex min-h-0 flex-col", className)}>
      {synced ? (
        <SyncedLyrics
          lines={displayLines}
          offset={offset}
          fontSize={fontSize}
          onArt={onArt}
          reduce={reduce}
          selecting={selecting}
          picked={picked}
          onPick={(i) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= 4 ? p : [...p, i].sort((a, b) => a - b)))}
        />
      ) : (
        <StaticList
          lines={plainLines}
          fontSize={Math.round(fontSize * 0.8)}
          onArt={onArt}
          selecting={selecting}
          picked={picked}
          onPick={(i) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length >= 4 ? p : [...p, i].sort((a, b) => a - b)))}
        />
      )}

      {/* toolbar */}
      <div className="relative flex shrink-0 items-center gap-1 pt-2">
        {selecting ? (
          <>
            <span className={cx("min-w-0 flex-1 truncate text-[13px]", onArt ? "text-white/70" : "text-fg-2")}>
              {picked.length ? `${picked.length} of 4 lines` : "Tap up to 4 lines to share"}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelecting(false);
                setPicked([]);
              }}
              className={cx("h-8 rounded-full px-3 text-[13px] font-semibold", tone)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!picked.length}
              onClick={() => {
                useUi.getState().setLyricsShare({ track, lines: picked.map((i) => shareLines[i]).filter(Boolean) });
                setSelecting(false);
                setPicked([]);
              }}
              className={cx(
                "h-8 rounded-full px-4 text-[13px] font-bold disabled:opacity-40",
                onArt ? "bg-white text-black" : "bg-primary text-on-primary"
              )}
            >
              Share
            </button>
          </>
        ) : (
          <>
            <span className={cx("min-w-0 flex-1 truncate text-[11.5px]", onArt ? "text-white/40" : "text-fg-3")}>
              {source ? "Lyrics via Sidify" : ""}
              {showingTranslated ? " · Translated by Sidify" : ""}
              {offset ? ` · ${offset > 0 ? "+" : ""}${(offset / 1000).toFixed(1)}s` : ""}
            </span>
            {hasSync && (
              <button
                type="button"
                onClick={() => setMode(synced ? "static" : "synced")}
                className={cx("h-8 rounded-full px-2.5 text-[12px] font-semibold", tone)}
                title={synced ? "Show plain lyrics" : "Show timed lyrics"}
              >
                {synced ? "Plain" : "Timed"}
              </button>
            )}
            {synced && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Lyrics timing"
                  title="Lyrics timing"
                  onClick={() => setTimingOpen((v) => !v)}
                  className={cx("grid h-8 w-8 place-items-center rounded-full", tone)}
                >
                  <Timer size={16} />
                </button>
                {timingOpen && (
                  <div className="menu-glass absolute right-0 bottom-10 z-20 w-[220px] rounded-[14px] p-3 text-fg">
                    <div className="mb-2 text-[13px] font-semibold">Lyrics timing</div>
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => changeOffset(-500)} className="grid h-8 w-8 place-items-center rounded-full bg-fill-2" aria-label="Earlier">
                        <Minus size={15} />
                      </button>
                      <span className="text-[14px] font-semibold tabular-nums">
                        {offset > 0 ? "+" : ""}
                        {(offset / 1000).toFixed(1)}s
                      </span>
                      <button type="button" onClick={() => changeOffset(500)} className="grid h-8 w-8 place-items-center rounded-full bg-fill-2" aria-label="Later">
                        <Plus size={15} />
                      </button>
                    </div>
                    <p className="mt-2 text-[11.5px] leading-snug text-fg-2">Later if the words run ahead of the singer, earlier if they lag.</p>
                    {offset !== 0 && (
                      <button type="button" onClick={() => changeOffset(-offset)} className="mt-2 text-[12px] font-semibold text-playing">
                        Reset
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              aria-label="Share lyrics"
              title="Share lyrics"
              onClick={() => setSelecting(true)}
              className={cx("grid h-8 w-8 place-items-center rounded-full", tone)}
            >
              <Share size={16} />
            </button>
            <a
              href={`https://translate.google.com/?sl=auto&tl=${encodeURIComponent(translateTarget())}&op=translate&text=${encodeURIComponent(plainLines.join("\n").slice(0, 4500))}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Translate lyrics"
              title="Translate lyrics"
              className={cx("grid h-8 w-8 place-items-center rounded-full", tone)}
            >
              <Languages size={16} />
            </a>
            <CopyButton text={plainLines.join("\n")} tone={tone} />
          </>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, tone }: { text: string; tone: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy lyrics"
      title="Copy lyrics"
      onClick={async () => {
        try {
          await copyText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          useUi.getState().pushToast({ title: "Couldn't copy", kind: "warn" });
        }
      }}
      className={cx("grid h-8 w-8 place-items-center rounded-full", tone)}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

/* --------------------------------- synced --------------------------------- */

export function SyncedLyrics({
  lines,
  offset,
  fontSize,
  onArt,
  reduce,
  selecting,
  picked,
  onPick,
}: {
  lines: LyricLine[];
  offset: number;
  fontSize: number;
  onArt: boolean;
  reduce: boolean;
  selecting: boolean;
  picked: number[];
  onPick: (i: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(-1);
  const [lead, setLead] = useState(-1);
  const [browsing, setBrowsing] = useState(false);
  const browseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const introGap = lines[0]?.startMs > 4500;

  useEffect(() => {
    if (browsing || selecting) return;
    const sc = scrollRef.current;
    const el = rows.current[Math.max(0, lead)];
    if (!sc || !el) return;
    const top = el.offsetTop - sc.clientHeight * 0.3;
    const far = Math.abs(sc.scrollTop - top) > sc.clientHeight * 1.5;
    sc.scrollTo({ top, behavior: first.current || far || reduce ? "auto" : "smooth" });
    first.current = false;
  }, [lead, browsing, selecting, reduce]);

  const noteBrowse = () => {
    setBrowsing(true);
    if (browseTimer.current) clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(() => setBrowsing(false), 4000);
  };
  useEffect(() => () => {
    if (browseTimer.current) clearTimeout(browseTimer.current);
  }, []);

  return (
    <div
      ref={scrollRef}
      onWheel={noteBrowse}
      onTouchMove={noteBrowse}
      className={cx("no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain", (browsing || selecting) && "lyrics-browsing", !onArt && "lyrics-on-page")}
      style={{
        WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 7%, #000 82%, transparent 100%)",
        maskImage: "linear-gradient(180deg, transparent 0, #000 7%, #000 82%, transparent 100%)",
      }}
    >
      <LyricsClock lines={lines} offset={offset} rows={rows} active={active} onActive={setActive} onLead={setLead} />
      <div style={{ height: "26%" }} />
      {introGap && (
        <div className={cx("py-4 transition-opacity duration-500", active < 0 ? "opacity-100" : "opacity-0")}>
          <span className={cx("gap-dots inline-flex gap-[5px]", onArt ? "text-white" : "text-fg")}>
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {lines.map((line, i) => {
        const d = active < 0 ? i + 1 : Math.abs(i - active);
        const state = i === active ? "active" : i < active ? "past" : "next";
        const k = Math.min(d, 4);
        const isPicked = picked.includes(i);
        return (
          <button
            key={`${line.startMs}-${i}`}
            ref={(el) => {
              rows.current[i] = el;
            }}
            type="button"
            data-state={state}
            data-wipe={i === active && !reduce ? 1 : 0}
            onClick={() => (selecting ? onPick(i) : seekTo(Math.max(0, line.startMs + offset)))}
            className={cx("lyric-line my-[2px] rounded-[10px] px-2 py-[9px]", isPicked && "bg-white/16")}
            style={{
              fontSize,
              opacity: state === "active" || selecting ? 1 : FALLOFF_ALPHA[k],
            }}
          >
            <span>{line.text}</span>
          </button>
        );
      })}
      <div style={{ height: "62%" }} />
    </div>
  );
}

/**
 * Ticks with the media clock (60fps) imperatively with ZERO React re-renders:
 * updates `--lp` directly on the active DOM node and only lifts active / lead
 * indices into React state when a line boundary is crossed.
 */
function LyricsClock({
  lines,
  offset,
  rows,
  active,
  onActive,
  onLead,
}: {
  lines: LyricLine[];
  offset: number;
  rows: React.RefObject<(HTMLButtonElement | null)[]>;
  active: number;
  onActive: (i: number) => void;
  onLead: (i: number) => void;
}) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const clock = useRef(positionMs);
  const last = useRef({ idx: -2, lead: -2 });
  const callbacksRef = useRef({ onActive, onLead, lines, offset, active });

  useEffect(() => {
    callbacksRef.current = { onActive, onLead, lines, offset, active };
  }, [onActive, onLead, lines, offset, active]);

  const applyAt = useCallback(
    (mediaMs: number) => {
      const { lines: curLines, offset: curOffset, onActive: emitActive, onLead: emitLead } = callbacksRef.current;
      const pos = mediaMs - curOffset;
      const idx = activeLineIndex(curLines, pos);
      const leadIdx = activeLineIndex(curLines, pos + SCROLL_LEAD_MS);

      if (idx !== last.current.idx) {
        last.current.idx = idx;
        emitActive(idx);
      }
      if (leadIdx !== last.current.lead) {
        last.current.lead = leadIdx;
        emitLead(leadIdx);
      }

      if (idx >= 0) {
        const el = rows.current?.[idx];
        if (el) {
          const start = curLines[idx].startMs;
          const end = curLines[idx + 1]?.startMs ?? start + 4000;
          const span = Math.max(600, Math.min(end - start, 9000) * 0.92);
          const p = Math.max(0, Math.min(1, (pos - start) / span));
          el.style.setProperty("--lp", `${(p * 112 - 6).toFixed(1)}%`);
        }
      }
    },
    [rows]
  );

  useEffect(() => {
    if (needsResync(clock.current, positionMs, isPlaying)) {
      clock.current = positionMs;
    }
    if (!isPlaying) {
      applyAt(clock.current);
    }
  }, [positionMs, isPlaying, offset, lines, applyAt]);

  useEffect(() => {
    applyAt(clock.current);
    if (!isPlaying) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      clock.current = advanceMediaClock(clock.current, now - prev, usePlayer.getState().speed || 1, durationMs);
      prev = now;
      applyAt(clock.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, durationMs, lines, offset, applyAt]);

  return null;
}

/* --------------------------------- static --------------------------------- */

function StaticList({
  lines,
  fontSize,
  onArt,
  selecting,
  picked,
  onPick,
}: {
  lines: string[];
  fontSize: number;
  onArt: boolean;
  selecting: boolean;
  picked: number[];
  onPick: (i: number) => void;
}) {
  return (
    <div
      className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-6"
      style={{
        WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 5%, #000 90%, transparent 100%)",
        maskImage: "linear-gradient(180deg, transparent 0, #000 5%, #000 90%, transparent 100%)",
      }}
    >
      {lines.map((text, i) =>
        text.trim() ? (
          <button
            key={i}
            type="button"
            disabled={!selecting}
            onClick={() => onPick(i)}
            className={cx(
              "block w-full rounded-[8px] px-2 py-[3px] text-left leading-[1.3] font-bold tracking-[-0.3px] disabled:cursor-text",
              onArt ? "text-white/90" : "text-fg/90",
              picked.includes(i) && "bg-white/16"
            )}
            style={{ fontSize }}
          >
            {text}
          </button>
        ) : (
          <div key={i} style={{ height: fontSize * 0.9 }} />
        )
      )}
    </div>
  );
}

/* ------------------------------ empty / loading ---------------------------- */

const SKELETON = [
  [0.82, 0.64, 0.74],
  [0.58, 0.86],
  [0.7, 0.52, 0.8, 0.62],
];

function LyricsSkeleton({ onArt, className }: { onArt: boolean; className?: string }) {
  return (
    <div className={cx("flex min-h-0 flex-col gap-9 overflow-hidden pt-[18%]", className)} role="status" aria-label="Finding lyrics">
      {SKELETON.map((block, b) => (
        <div key={b} className="space-y-[15px]">
          {block.map((w, i) => (
            <div
              key={i}
              className={cx("h-[26px] animate-pulse rounded-[8px]", onArt ? "bg-white/14" : "bg-fill-2")}
              style={{ width: `${w * 100}%`, animationDelay: `${(b * 3 + i) * 90}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function NotFound({
  onArt,
  className,
  instrumental,
  message,
  track,
  onSearch,
  onRetry,
}: {
  onArt: boolean;
  className?: string;
  instrumental: boolean;
  message: string;
  track: Track;
  onSearch: (title: string, artist: string) => void;
  onRetry: () => void;
}) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  return (
    <div className={cx("flex min-h-0 flex-col items-center justify-center px-2 text-center", className)}>
      <p className={cx("text-[22px] font-bold tracking-[-0.3px]", onArt ? "text-white" : "text-fg")}>
        {instrumental ? "Instrumental" : "No lyrics for this one"}
      </p>
      <p className={cx("mt-1.5 max-w-[320px] text-[14px]", onArt ? "text-white/60" : "text-fg-2")}>
        {instrumental ? "Just the music — enjoy it." : message || "We couldn't find words for this song. Try a different title or singer."}
      </p>
      {!instrumental && (
        <form
          className="mt-5 flex w-full max-w-[360px] flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            onSearch(title.trim(), artist.trim());
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Song title"
            aria-label="Song title"
            className={cx("field h-10", onArt && "!bg-white/12 !text-white placeholder:!text-white/50")}
          />
          <input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Singer"
            aria-label="Singer"
            className={cx("field h-10", onArt && "!bg-white/12 !text-white placeholder:!text-white/50")}
          />
          <div className="mt-1 flex gap-2">
            <button
              type="submit"
              className={cx(
                "flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-[14px] font-semibold",
                onArt ? "bg-white text-black" : "bg-primary text-on-primary"
              )}
            >
              <Search size={15} /> Search lyrics
            </button>
            <button
              type="button"
              onClick={onRetry}
              className={cx("h-10 rounded-full px-4 text-[14px] font-semibold", onArt ? "bg-white/15 text-white" : "bg-fill-2 text-fg")}
            >
              Retry
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
