"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock3, Copy, Download, Sparkles, X } from "lucide-react";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";
import { ANDROID_APP } from "@/lib/appRelease";

/* ------------------------------------------------------------------ */
/*  Content. The changelog lives here so the popup is the single       */
/*  source of truth for "what shipped".                                */
/* ------------------------------------------------------------------ */

export const UPDATE_INFO = {
  tag: "Minor update 1.5",
  date: "27 Sept 2026",
  headline: "Background playback: the song keeps going when the screen goes off",
  items: [
    "On phones the engine now hands the song to a plain audio element the moment you leave the app or lock the screen — that is the one thing mobile browsers never silence, so the music stops pausing.",
    "If a browser still pauses playback (it happens when a song can only play through the YouTube embed), Sidify notices within a second and resumes it — up to two attempts per screen-off, so it never fights your own pause.",
    "New Settings → System row “Playback engine” — shows live whether the current song is Background-safe (plain audio) or Pauses off-screen (YouTube embed), with a one-tap Fix button.",
    "“Copy report” in the same row copies the engine, audio-context, screen and event log — paste it when reporting “it still pauses on my phone” so the real cause can be found.",
    "Lock-screen controls now report the true play/pause state and position, so the notification can’t drift from what you hear.",
    "The background guide now explains the honest limits: installing the site as an app (homescreen or TWA) does NOT change these browser rules — Brave’s background-play setting or the native Android app do.",
    `Want zero browser rules? The ${ANDROID_APP.name} app in Settings → About plays with the screen off, always.`,
  ],
};

const LOCK_SECONDS = 5;
const SEEN_KEY = "sidify-notices-shown";
const BG_HELP_SEEN_KEY = "sidify-background-help-shown";
// Also remember within this page when browser storage is blocked.
let backgroundHelpShown = false;

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

/**
 * Brave keeps audio alive when its tab goes to the background (Settings → Media →
 * Background play), so it needs no per-session ritual. That makes it the primary
 * instruction; the browser-agnostic flow below stays as the secondary option for
 * anyone who does not want to install anything.
 */
const BRAVE_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.brave.browser";

const BRAVE_STEPS = [
  "Install the Brave browser from the Google Play Store using the Install button below.",
  "Copy the Sidify site link with the button below, paste it in Brave’s address bar and open it.",
  "Search any song you like and press play. Wait until the music actually starts.",
  "Now press back, switch apps or lock your screen — the song keeps playing in the background.",
];

const BG_STEPS = [
  "Open this site in your browser. On a phone, tap the three-dot menu at the top and press “Desktop site”.",
  "Check that Desktop site is turned ON. The page will look like the computer version.",
  "Search for a song and press play. Wait until the music actually starts.",
  "Now press the back button or go to another app. The music will pause — that is normal. Do not close the tab.",
  "Pull down the notification panel from the top of your screen.",
  "Open the Sidify notification and press play there. The song continues with your screen off.",
];

export const BG_HELP_SUMMARY = "How to keep music playing with a closed app or a locked screen";

/* Small building blocks so both methods share the exact same visual language. */

function MethodBadge({ tone }: { tone: "primary" | "secondary" }) {
  return tone === "primary" ? (
    <span className="accent-bg shrink-0 rounded-full px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.16em] text-black uppercase">
      Recommended
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-[var(--panel-strong)] px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.16em] text-muted uppercase">
      Secondary
    </span>
  );
}

function StepList({ steps, tone }: { steps: string[]; tone: "primary" | "secondary" }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-3">
          <span
            className={cx(
              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
              tone === "primary" ? "accent-bg text-black" : "bg-[var(--panel-strong)] accent-text"
            )}
          >
            {i + 1}
          </span>
          <span className="min-w-0 text-[13.5px] leading-[21px]">{s}</span>
        </li>
      ))}
    </ol>
  );
}

function BackgroundHelp({ onClose }: { onClose: () => void }) {
  // This guide mounts only after a client-side action. Resolve the delay once,
  // before Sheet mounts, so returning visitors never flash a countdown.
  const [closeAfter] = useState(() => {
    if (backgroundHelpShown) return 0;
    try {
      return localStorage.getItem(BG_HELP_SEEN_KEY) ? 0 : LOCK_SECONDS;
    } catch {
      return LOCK_SECONDS;
    }
  });

  useEffect(() => {
    backgroundHelpShown = true;
    try {
      localStorage.setItem(BG_HELP_SEEN_KEY, "1");
    } catch {
      // The in-memory flag still skips the timer on subsequent opens this page.
    }
  }, []);

  const pushToast = useUi((s) => s.pushToast);
  const [copied, setCopied] = useState(false);

  // This sheet is only ever mounted from a client-side click, so `window` is always
  // available; the server guard just keeps the render pure.
  const siteLink =
    typeof window === "undefined" ? "" : `${window.location.origin}${window.location.pathname}`;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copyLink = async () => {
    const url = siteLink || window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Non-HTTPS contexts block the async API — fall back to the legacy command.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setCopied(true);
      pushToast({ title: "Site link copied", desc: "Paste it in Brave’s address bar", kind: "ok" });
    } else {
      pushToast({ title: "Tap the link, select it and copy", desc: url, kind: "warn" });
    }
  };

  return (
    <Sheet onClose={onClose} closeAfter={closeAfter}>
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

      <p className="text-muted mb-4 text-[13.5px] leading-6">
        Mobile browsers stop audio the moment you leave a page. The fastest fix is four steps with Brave; the
        second method works in the browser you already have. Do this once per session.
      </p>

      <div className="glass mb-5 rounded-2xl px-4 py-3 text-[12.5px] leading-5 text-muted">
        <span className="font-bold accent-text">Why this happens:</span> Sidify plays through either a plain
        audio engine (keeps playing in the background) or the YouTube embed (Chrome pauses it when the screen
        goes off — Brave keeps it running). Newer builds hand audio over to the plain engine the moment the app
        goes off-screen. Settings → System shows which engine is live right now, with a “Copy report” button if
        it still stops. Installing the site as an app (homescreen / TWA) does <span className="font-semibold">not</span>
        change these browser rules — only Brave’s own background-play setting or the native app does.
      </div>

      {/* ---- Method 1 — recommended ---- */}
      <section
        className="rounded-2xl border p-4 md:p-5"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 32%, transparent)",
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
        }}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[15px] leading-tight font-extrabold tracking-tight">
            Method 1 · Play with Brave browser
          </h3>
          <MethodBadge tone="primary" />
        </div>

        <StepList steps={BRAVE_STEPS} tone="primary" />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a
            href={BRAVE_PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ring-focus inline-flex flex-1 items-center justify-center gap-2 rounded-2xl accent-bg px-4 py-2.5 text-[13.5px] font-bold text-black transition-transform hover:scale-[1.01] active:scale-95"
            style={{ boxShadow: "0 12px 34px -14px var(--glow)" }}
          >
            <Download size={15} strokeWidth={2.4} /> Install Brave
          </a>
          <button
            type="button"
            onClick={copyLink}
            className="ring-focus glass hover-panel accent-text inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-[13.5px] font-bold active:scale-95"
          >
            {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}
            {copied ? "Link copied" : "Copy site link"}
          </button>
        </div>

        {siteLink ? (
          <p className="text-muted-2 mt-2.5 text-center text-[11.5px] leading-4 break-all">{siteLink}</p>
        ) : (
          <p className="text-muted-2 mt-2.5 text-center text-[11.5px] leading-4">
            Or copy the link from your address bar.
          </p>
        )}
      </section>

      {/* ---- Method 2 — secondary ---- */}
      <section className="glass mt-4 rounded-2xl p-4 md:p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-[15px] leading-tight font-extrabold tracking-tight">
            Method 2 · Without installing anything
          </h3>
          <MethodBadge tone="secondary" />
        </div>
        <p className="text-muted mb-3 text-[12.5px] leading-5">
          Chrome, Samsung Internet or any other browser. It works, but you have to press play in the
          notification every time you leave the page.
        </p>

        <StepList steps={BG_STEPS} tone="secondary" />
      </section>

      <div className="glass mt-4 rounded-2xl px-4 py-3 text-[12.5px] leading-5 text-muted">
        <span className="font-bold accent-text">Tip:</span> if Brave still pauses, open its three-dot menu →
        Settings → Media and turn “Background play” ON. With Method 2, stay on the tab, and use the Sidify
        notification to pause, skip or go back. Turning off “Data Saver” also helps. Want it guaranteed? Install
        the {ANDROID_APP.name} app from Settings → About — it plays with the screen off, always.
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
