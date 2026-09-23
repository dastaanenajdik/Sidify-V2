"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Download, Music4, Pause, Play, SkipBack, SkipForward, Sparkles } from "lucide-react";
import { ANDROID_APP, APP_SIZE_LABEL } from "@/lib/appRelease";
import { cx } from "@/lib/format";
import { useUi } from "@/store/ui";
import { LiveEq } from "./SidifyLogo";

/* ------------------------------------------------------------------ */
/*  The one download button every surface reuses.                      */
/* ------------------------------------------------------------------ */

export function ApkDownloadButton({
  variant = "solid",
  className,
  label = "Download the APK",
}: {
  /** `hero` = the giant one, `solid` = regular, `compact` = single-line pill. */
  variant?: "hero" | "solid" | "compact";
  className?: string;
  label?: string;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const [started, setStarted] = useState(false);

  const size =
    variant === "hero"
      ? "rounded-3xl px-7 py-4 text-[16px] gap-3 md:px-9 md:py-5 md:text-[18px]"
      : variant === "compact"
        ? "rounded-xl px-3.5 py-2.5 text-[13px] gap-2"
        : "rounded-2xl px-6 py-3.5 text-[14.5px] gap-3";

  const iconBox =
    variant === "hero" ? "h-9 w-9 md:h-10 md:w-10" : variant === "compact" ? "h-6 w-6" : "h-7 w-7";
  const iconSize = variant === "hero" ? 20 : variant === "compact" ? 15 : 16;

  return (
    <a
      href={ANDROID_APP.apkUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        setStarted(true);
        pushToast({
          title: "Download starting…",
          desc: `${ANDROID_APP.fileName} · ${APP_SIZE_LABEL}`,
          kind: "ok",
        });
        setTimeout(() => setStarted(false), 5000);
      }}
      className={cx(
        "ring-focus group relative inline-flex shrink-0 items-center justify-center accent-bg font-bold text-black transition-transform hover:scale-[1.02] active:scale-95",
        size,
        className
      )}
      style={{ boxShadow: "0 18px 50px -12px var(--glow), 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent)" }}
      aria-label={`${label} — ${ANDROID_APP.fileName}, ${APP_SIZE_LABEL}, version ${ANDROID_APP.version}`}
    >
      <span className={cx("grid shrink-0 place-items-center rounded-full bg-black/12", iconBox)}>
        {started ? (
          <Check size={iconSize} strokeWidth={3.2} />
        ) : (
          <Download size={iconSize} strokeWidth={2.6} className="transition-transform group-hover:translate-y-[1px]" />
        )}
      </span>
      {variant === "compact" ? (
        <span>{started ? "Started" : label}</span>
      ) : (
        <span className="flex flex-col items-start leading-tight">
          <span>{started ? "Download started" : label}</span>
          <span className={cx("font-semibold text-black/60", variant === "hero" ? "text-[11.5px]" : "text-[10.5px]")}>
            {ANDROID_APP.fileName} · {APP_SIZE_LABEL}
          </span>
        </span>
      )}
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Device mock — a small portrait of the app itself.                  */
/* ------------------------------------------------------------------ */

export function PhoneMock({ className }: { className?: string }) {
  return (
    <div className={cx("relative select-none", className)} aria-hidden>
      <div
        className="pointer-events-none absolute -inset-10 rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
      />

      <div
        className="relative w-[228px] rounded-[40px] p-[10px]"
        style={{
          background: "linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 40%, rgba(0,0,0,0.5))",
          boxShadow: "0 40px 90px -30px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.14)",
        }}
      >
        <div className="relative overflow-hidden rounded-[31px] bg-[#07070c] px-4 pt-3 pb-5">
          {/* status bar */}
          <div className="mb-3 flex items-center justify-between text-[9px] font-semibold text-white/55">
            <span>9:41</span>
            <span className="absolute left-1/2 top-[10px] h-[18px] w-[64px] -translate-x-1/2 rounded-full bg-black" />
            <span className="flex items-center gap-1">
              <span className="h-[7px] w-[7px] rounded-full accent-bg" />
              <span>5G</span>
            </span>
          </div>

          {/* header */}
          <div className="mb-3 mt-1 flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-lg accent-bg text-[11px] font-extrabold text-black">I</span>
            <span className="text-[11px] font-bold text-white">IfallMusic</span>
            <span className="ml-auto rounded-full border border-white/12 px-2 py-[2px] text-[8px] font-bold tracking-widest text-white/60 uppercase">
              Offline
            </span>
          </div>

          {/* artwork */}
          <div
            className="relative mb-3 grid h-[150px] w-full place-items-center overflow-hidden rounded-2xl"
            style={{ background: "linear-gradient(145deg, color-mix(in srgb, var(--accent) 55%, #111), #0a0a12 65%)" }}
          >
            <Music4 size={44} className="text-white/85" />
            <span className="absolute inset-0" style={{ background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,0.24), transparent 60%)" }} />
            <span className="absolute bottom-2 left-2 flex items-end gap-[3px]" style={{ height: 16 }}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="eq-bar inline-block w-[3px] rounded-full bg-white/90"
                  style={{ height: "100%", animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </span>
            <span className="absolute right-2 bottom-2 rounded-full bg-black/45 px-2 py-[3px] text-[8px] font-bold text-white backdrop-blur">
              8D · ORBIT
            </span>
          </div>

          {/* track meta */}
          <div className="mb-2">
            <div className="truncate text-[12.5px] font-bold text-white">Midnight Drive</div>
            <div className="truncate text-[10px] text-white/55">Ifall Music · Now playing</div>
          </div>

          {/* progress */}
          <div className="mb-3">
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/12">
              <div className="h-full w-[46%] rounded-full accent-bg" style={{ boxShadow: "0 0 10px var(--glow)" }} />
            </div>
            <div className="mt-1 flex justify-between text-[8px] font-semibold text-white/45 tabular-nums">
              <span>1:24</span>
              <span>3:07</span>
            </div>
          </div>

          {/* controls */}
          <div className="flex items-center justify-center gap-4">
            <SkipBack size={15} className="text-white/70" fill="currentColor" strokeWidth={0} />
            <span className="grid h-11 w-11 place-items-center rounded-full accent-bg text-black" style={{ boxShadow: "0 8px 26px -6px var(--glow)" }}>
              <Pause size={17} fill="currentColor" strokeWidth={0} />
            </span>
            <SkipForward size={15} className="text-white/70" fill="currentColor" strokeWidth={0} />
          </div>

          {/* bottom chips */}
          <div className="mt-4 flex items-center justify-center gap-1.5">
            <span className="rounded-full bg-white/8 px-2 py-[3px] text-[8px] font-semibold text-white/70">Equalizer</span>
            <span className="rounded-full bg-white/8 px-2 py-[3px] text-[8px] font-semibold text-white/70">Queue</span>
            <span className="rounded-full bg-white/8 px-2 py-[3px] text-[8px] font-semibold text-white/70">Sleep 15m</span>
          </div>
        </div>

        {/* side buttons */}
        <span className="absolute -right-[3px] top-[110px] h-14 w-[3px] rounded-full bg-white/20" />
        <span className="absolute -left-[3px] top-[92px] h-8 w-[3px] rounded-full bg-white/20" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Home banner — the first thing you see on the site.                 */
/* ------------------------------------------------------------------ */

export function AppPromoBanner() {
  return (
    <section
      className="relative mb-7 overflow-hidden rounded-[28px] border p-5 md:p-8"
      style={{
        borderColor: "color-mix(in srgb, var(--accent) 42%, transparent)",
        background:
          "linear-gradient(120deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 58%), var(--bg-elev)",
        boxShadow: "0 30px 80px -40px var(--glow)",
      }}
    >
      <div
        className="pointer-events-none absolute -top-28 -right-10 h-72 w-72 rounded-full blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
      />
      <div className="pointer-events-none absolute -bottom-28 -left-16 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" />

      <div className="relative flex flex-col items-start gap-7 md:flex-row md:items-center md:justify-between md:gap-10">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 rounded-full accent-bg px-3 py-1 text-[10.5px] font-extrabold tracking-[0.16em] text-black uppercase">
              <Sparkles size={12} strokeWidth={3} /> New app
            </span>
            <span className="glass flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full accent-bg" />
              {ANDROID_APP.name} {ANDROID_APP.tag} · released {ANDROID_APP.released}
            </span>
          </div>

          <h2 className="font-display max-w-[19ch] text-[30px] leading-[1.03] font-extrabold tracking-tight md:text-[44px]">
            Our <span className="accent-text text-glow">Android app</span> is out.
            <br />
            Get it in one tap.
          </h2>

          <p className="text-muted mt-3 max-w-lg text-[14px] leading-6 md:text-[15px]">
            The same Sidify universe, now a real app on your phone — background playback, a studio equalizer, 8D
            spatial audio and offline downloads. Free APK, no account, ready in a minute.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ApkDownloadButton variant="hero" label="Download the app" />
            <Link
              href="/app"
              className="ring-focus glass hover-panel flex items-center gap-2 rounded-2xl px-5 py-3.5 text-[14px] font-bold transition-transform hover:scale-[1.02] active:scale-95"
            >
              What&apos;s inside <ArrowRight size={15} />
            </Link>
          </div>

          <div className="text-muted-2 mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] font-semibold">
            <span className="flex items-center gap-1.5">
              <Check size={12} className="accent-text" strokeWidth={3.4} /> Free
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={12} className="accent-text" strokeWidth={3.4} /> No sign-in
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={12} className="accent-text" strokeWidth={3.4} /> {APP_SIZE_LABEL} APK
            </span>
            <span className="flex items-center gap-1.5">
              <LiveEq size={12} /> Background playback
            </span>
          </div>
        </div>

        <PhoneMock className="hidden shrink-0 md:block" />
      </div>
    </section>
  );
}

/* Small reusable bit so other screens can show "playing in the app" flavour. */
export function NowPlayingChip({ label = "Now playing in the app" }: { label?: string }) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-bold">
      <LiveEq size={12} />
      {label}
      <Play size={10} fill="currentColor" strokeWidth={0} className="accent-text" />
    </span>
  );
}
