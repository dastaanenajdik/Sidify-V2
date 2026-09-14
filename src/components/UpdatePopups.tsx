"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock3, Sparkles, X } from "lucide-react";
import { useUi } from "@/store/ui";

/* ------------------------------------------------------------------ */
/*  Content. The changelog lives here so the popup is the single       */
/*  source of truth for "what shipped".                                */
/* ------------------------------------------------------------------ */

export const UPDATE_INFO = {
  tag: "Minor update 1.0",
  date: "14 Sept 2026",
  headline: "Playback, likes and playlists are all fixed",
  items: [
    "Songs now play one after another — when a song ends, a similar song starts on its own.",
    "Playlists, Liked Songs and search results keep rolling to the next song and the one after that.",
    "The first song you tap now starts right away (earlier you had to tap a second song).",
    "Like ❤ works again — liked songs are saved and show up in Your Library.",
    "“Add to playlist” works — tap a playlist in the list and the song goes straight into it.",
    "Creating a new playlist works — type a name, hit Save, and it appears in your library.",
    "Listening history updates while you play, so the History tab is never stale.",
    "Song errors now skip ahead to a similar track instead of stopping playback.",
    "New guide inside Settings: “Instructions to play in background”.",
  ],
};

const LOCK_SECONDS = 5;
const SEEN_KEY = "sidify-notices-shown";

/* ------------------------------------------------------------------ */
/*  Shell: same glass panel language as the rest of the app.           */
/* ------------------------------------------------------------------ */

function Sheet({
  onClose,
  closeAfter,
  children,
}: {
  onClose: () => void;
  /** Seconds the close button stays locked away (0 = always available). */
  closeAfter: number;
  children: React.ReactNode;
}) {
  const [left, setLeft] = useState(closeAfter);

  // Countdown to the close button. The timer owns every update, so the first paint
  // never triggers a cascading render.
  useEffect(() => {
    if (closeAfter <= 0) return;
    const started = Date.now();
    const tick = setInterval(() => {
      const done = Math.floor((Date.now() - started) / 1000);
      setLeft(Math.max(0, closeAfter - done));
      if (Date.now() - started >= closeAfter * 1000) clearInterval(tick);
    }, 200);
    return () => clearInterval(tick);
  }, [closeAfter]);

  const locked = left > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[95] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        style={{ background: "color-mix(in srgb, var(--bg-deep) 55%, transparent)" }}
      />
      <motion.div
        initial={{ scale: 0.94, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 10, opacity: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 340 }}
        className="glass-strong relative w-full max-w-[540px] overflow-hidden rounded-3xl"
        style={{ boxShadow: "0 30px 80px -20px var(--shadow)" }}
        role="dialog"
        aria-modal="true"
      >
        {/* accent wash, same treatment as the home hero */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(120deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%)" }}
        />
        <div className="pointer-events-none absolute -top-20 -right-14 h-56 w-56 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }} />

        {/* corner close / countdown */}
        <div className="absolute top-4 right-4 z-10">
          {locked ? (
            <span className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold text-muted tabular-nums">
              <Clock3 size={12} /> {left}s
            </span>
          ) : (
            <button
              onClick={onClose}
              aria-label="Close"
              className="hover-panel grid h-9 w-9 place-items-center rounded-full text-muted hover:text-[var(--text)]"
            >
              <X size={19} />
            </button>
          )}
        </div>

        <div className="relative max-h-[82dvh] overflow-y-auto px-6 pt-6 pb-6 md:px-7">
          {children}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Update notice                                                   */
/* ------------------------------------------------------------------ */

function UpdateNotice({ onNext }: { onNext: () => void }) {
  return (
    <Sheet onClose={onNext} closeAfter={0}>
      <div className="mb-4 flex items-center gap-2.5 pr-10">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl accent-bg text-black">
          <Sparkles size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-muted text-[10.5px] font-bold tracking-[0.22em] uppercase">Update notice</div>
          <h2 className="font-display text-[20px] leading-tight font-extrabold tracking-tight">{UPDATE_INFO.tag}</h2>
        </div>
      </div>

      <p className="text-muted mb-1 text-[12.5px] font-semibold">
        Date <span className="text-[var(--text)]">— {UPDATE_INFO.date}</span>
      </p>
      <p className="mb-5 text-[14px] leading-6 font-medium accent-text">{UPDATE_INFO.headline}</p>

      <ul className="space-y-2.5">
        {UPDATE_INFO.items.map((it) => (
          <li key={it} className="flex gap-2.5 text-[13.5px] leading-[22px]">
            <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full accent-bg text-black">
              <Check size={11} strokeWidth={3.4} />
            </span>
            <span className="min-w-0 text-[var(--text)]">{it}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onNext}
        className="ring-focus mt-6 w-full rounded-2xl accent-bg py-3 text-[14px] font-bold text-black transition-transform hover:scale-[1.01] active:scale-95"
        style={{ boxShadow: "0 12px 34px -10px var(--glow)" }}
      >
        Got it
      </button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Background / off-screen playback guide                          */
/* ------------------------------------------------------------------ */

const BG_STEPS = [
  "Open this site in your browser. On a phone, tap the three-dot menu at the top and press “Desktop site”.",
  "Check that Desktop site is turned ON. The page will look like the computer version.",
  "Search for a song and press play. Wait until the music actually starts.",
  "Now press the back button or go to another app. The music will pause — that is normal. Do not close the tab.",
  "Pull down the notification panel from the top of your screen.",
  "Open the Sidify notification and press play there. The song continues with your screen off.",
];

export const BG_HELP_SUMMARY = "How to keep music playing with a closed app or a locked screen";

function BackgroundHelp({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} closeAfter={LOCK_SECONDS}>
      <div className="mb-4 flex items-center gap-2.5 pr-10">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--panel-strong)] accent-text">
          <Clock3 size={17} />
        </span>
        <div className="min-w-0">
          <div className="text-muted text-[10.5px] font-bold tracking-[0.22em] uppercase">Please note</div>
          <h2 className="font-display text-[19px] leading-tight font-extrabold tracking-tight">
            Instructions to play in background or off screen
          </h2>
        </div>
      </div>

      <p className="text-muted mb-5 text-[13.5px] leading-6">
        Mobile browsers stop audio when you leave a page. Six quick steps and Sidify keeps playing with the
        screen locked. Do this once per session.
      </p>

      <ol className="space-y-3">
        {BG_STEPS.map((s, i) => (
          <li key={s} className="flex gap-3">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--panel-strong)] text-[12px] font-bold accent-text">
              {i + 1}
            </span>
            <span className="min-w-0 text-[13.5px] leading-[21px]">{s}</span>
          </li>
        ))}
      </ol>

      <div className="glass mt-5 rounded-2xl px-4 py-3 text-[12.5px] leading-5 text-muted">
        <span className="font-bold accent-text">Tip:</span> after you press play in the notification, you can
        close the panel and lock your phone. Music keeps running. Use the same notification to pause, skip or go
        back. Turning off “Data Saver” also helps.
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Orchestrator — mounted once in Providers                           */
/* ------------------------------------------------------------------ */

export default function UpdatePopups() {
  const bgHelpOpen = useUi((s) => s.bgHelpOpen);
  const setBgHelpOpen = useUi((s) => s.setBgHelpOpen);
  const [showUpdate, setShowUpdate] = useState(false);

  // sessionStorage is only available on the client, so the decision is made right after
  // mount (before paint) instead of during the first render.
  useEffect(() => {
    let seen = "";
    try {
      seen = sessionStorage.getItem(SEEN_KEY) || "";
    } catch {
      seen = "";
    }
    if (seen) return;
    const raf = requestAnimationFrame(() => setShowUpdate(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const remember = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode - the notice simply shows again next visit */
    }
  };

  const finishUpdate = () => {
    setShowUpdate(false);
    remember();
    setBgHelpOpen(true);
  };

  const closeBg = () => setBgHelpOpen(false);

  return (
    <>
      <AnimatePresence>{showUpdate && <UpdateNotice onNext={finishUpdate} />}</AnimatePresence>
      <AnimatePresence>{bgHelpOpen && <BackgroundHelp onClose={closeBg} />}</AnimatePresence>
    </>
  );
}
