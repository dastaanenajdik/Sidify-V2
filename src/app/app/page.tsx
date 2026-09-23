"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BatteryCharging,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Infinity as InfinityIcon,
  ListMusic,
  MoonStar,
  Orbit,
  Package,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareArrowOutUpRight,
  Timer,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import {
  ANDROID_APP,
  APP_FAQ,
  APP_FEATURES,
  APP_SIZE_LABEL,
  APP_SPECS,
  APP_WHATS_NEW,
  INSTALL_STEPS,
} from "@/lib/appRelease";
import { cx } from "@/lib/format";
import { useUi } from "@/store/ui";
import { usePlayer, currentTrack } from "@/store/player";
import { ApkDownloadButton, PhoneMock } from "@/components/AppPromo";

type IconComp = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

const FEATURE_ICONS: Record<string, IconComp> = {
  "moon-star": MoonStar,
  "sliders-horizontal": SlidersHorizontal,
  orbit: Orbit,
  download: Download,
  "list-music": ListMusic,
  sparkles: Sparkles,
  timer: Timer,
  "shield-check": ShieldCheck,
};

const STATS: { icon: IconComp; label: string; value: string }[] = [
  { icon: Package, label: "Version", value: `${ANDROID_APP.version} latest` },
  { icon: Download, label: "Download size", value: APP_SIZE_LABEL },
  { icon: BatteryCharging, label: "Runs on", value: "Android" },
  { icon: InfinityIcon, label: "Price", value: "Free forever" },
];

export default function AppDownloadPage() {
  // The floating bar shares the screen with the mini player, so it steps up when a
  // song is loaded instead of covering the controls.
  const hasTrack = usePlayer((s) => !!currentTrack(s));

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-5 pb-24 md:px-7 md:pt-7 md:pb-10">
      {/* ------------------------------ HERO ------------------------------ */}
      <section
        className="relative mb-6 overflow-hidden rounded-[32px] border p-6 md:p-11"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
          background:
            "linear-gradient(120deg, color-mix(in srgb, var(--accent) 22%, transparent), transparent 58%), var(--bg-elev)",
          boxShadow: "0 40px 110px -50px var(--glow)",
        }}
      >
        <div
          className="pointer-events-none absolute -top-32 -right-16 h-80 w-80 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
        />
        <div className="pointer-events-none absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />

        <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_auto]">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center gap-2.5">
              <span className="flex items-center gap-1.5 rounded-full accent-bg px-3 py-1 text-[10.5px] font-extrabold tracking-[0.18em] text-black uppercase">
                <Sparkles size={12} strokeWidth={3} /> Android app
              </span>
              <span className="glass flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full accent-bg" />
                {ANDROID_APP.name} {ANDROID_APP.tag}
              </span>
              <span className="glass rounded-full px-3 py-1 text-[11px] font-bold text-muted">
                Released {ANDROID_APP.released}
              </span>
            </div>

            <h1 className="font-display text-[36px] leading-[1.0] font-extrabold tracking-tight sm:text-[46px] lg:text-[62px]">
              The Sidify app.
              <br />
              <span className="accent-text text-glow">Now on Android.</span>
            </h1>

            <p className="text-muted mt-4 max-w-xl text-[14.5px] leading-7 md:text-[16px]">
              Everything you love on this site, wrapped in a real phone app: background playback that survives a locked
              screen, a genuine studio equalizer, 8D spatial audio and offline downloads. Free APK, no account, running
              in about a minute.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ApkDownloadButton variant="hero" label="Download the APK" />
              <a
                href="#whats-new"
                className="ring-focus glass hover-panel flex items-center gap-2 rounded-2xl px-5 py-4 text-[14px] font-bold transition-transform hover:scale-[1.02] active:scale-95"
              >
                What&apos;s new <ArrowRight size={15} />
              </a>
              <CopyApkLink />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
              {[
                "Free · no ads",
                "No sign-in needed",
                `${ANDROID_APP.fileName} · ${APP_SIZE_LABEL}`,
                "Updates over the top",
              ].map((t) => (
                <span key={t} className="text-muted flex items-center gap-1.5 text-[12px] font-semibold">
                  <BadgeCheck size={13} className="accent-text" strokeWidth={2.6} /> {t}
                </span>
              ))}
            </div>
          </div>

          <div className="justify-self-center lg:pl-4">
            <PhoneMock />
          </div>
        </div>
      </section>

      {/* ------------------------------ STATS ----------------------------- */}
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="glass flex items-center gap-3.5 rounded-2xl p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--panel-strong)]">
              <s.icon size={19} className="accent-text" />
            </span>
            <span className="min-w-0">
              <span className="text-muted-2 block text-[10.5px] font-bold tracking-[0.16em] uppercase">{s.label}</span>
              <span className="block truncate text-[14.5px] font-bold">{s.value}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ---------------------------- FEATURES ---------------------------- */}
      <section className="mb-12">
        <Header
          eyebrow="Inside the app"
          title="Built to be the only music app you open"
          sub="Every feature below is on the phone, offline, with your screen off."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {APP_FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.icon] ?? Sparkles;
            return (
              <div
                key={f.title}
                className="glass hover-panel group relative overflow-hidden rounded-3xl p-5"
                style={{ boxShadow: "0 22px 60px -46px var(--shadow)" }}
              >
                <span
                  className="pointer-events-none absolute -top-16 -right-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
                />
                <span className="relative mb-4 grid h-12 w-12 place-items-center rounded-2xl accent-bg text-black">
                  <Icon size={22} strokeWidth={2.3} />
                </span>
                <h3 className="font-display relative text-[16.5px] leading-snug font-extrabold tracking-tight">{f.title}</h3>
                <p className="text-muted relative mt-1.5 text-[13px] leading-[21px]">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* --------------------------- WHAT'S NEW --------------------------- */}
      <section id="whats-new" className="mb-12 scroll-mt-6">
        <Header
          eyebrow={`Release notes · ${ANDROID_APP.tag}`}
          title={`What's new in ${ANDROID_APP.version}`}
          sub={`Shipped ${ANDROID_APP.released} — this is the build behind the download button.`}
        />
        <div className="glass-strong overflow-hidden rounded-3xl">
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-soft)] px-5 py-4 md:px-6"
            style={{ background: "linear-gradient(120deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%)" }}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl accent-bg text-black">
                <Sparkles size={18} />
              </span>
              <div>
                <div className="font-display text-[16px] font-extrabold tracking-tight">
                  {ANDROID_APP.name} {ANDROID_APP.version}
                </div>
                <div className="text-muted text-[12px]">The whole app rebuilt around glass, sound and speed</div>
              </div>
            </div>
            <a
              href={ANDROID_APP.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ring-focus glass hover-panel flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-bold"
            >
              Full notes on GitHub <SquareArrowOutUpRight size={13} />
            </a>
          </div>

          <ul className="grid grid-cols-1 gap-x-8 gap-y-3.5 p-5 md:grid-cols-2 md:p-6">
            {APP_WHATS_NEW.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-[3px] grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full accent-bg text-black">
                  <Check size={11} strokeWidth={3.6} />
                </span>
                <span className="text-[13.5px] leading-[22px]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ----------------------------- INSTALL ---------------------------- */}
      <section className="mb-12">
        <Header
          eyebrow="Install"
          title="Four taps and you're listening"
          sub="It is a sideloaded APK, so Android asks one extra question — here is the whole path."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {INSTALL_STEPS.map((s, i) => (
            <div key={s.title} className="glass relative rounded-3xl p-5">
              <span className="font-display accent-text text-[34px] leading-none font-extrabold opacity-70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display mt-2 text-[15.5px] font-extrabold tracking-tight">{s.title}</h3>
              <p className="text-muted mt-1.5 text-[13px] leading-[21px]">{s.desc}</p>
            </div>
          ))}
        </div>

        <div
          className="mt-4 flex flex-col gap-3 rounded-3xl border p-5 sm:flex-row sm:items-center"
          style={{
            borderColor: "color-mix(in srgb, #f59e0b 40%, transparent)",
            background: "color-mix(in srgb, #f59e0b 9%, transparent)",
          }}
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-400/15 text-amber-400">
            <TriangleAlert size={20} />
          </span>
          <p className="text-[13.5px] leading-[22px]">
            Seeing <span className="font-bold">“App not installed”</span>? Uninstall any older Sidify / Saxify build from
            your phone first, free up a little storage, then run the installer again. Google Play Protect may call the
            file an unknown app — that is normal for APKs outside the Play Store; choose{" "}
            <span className="font-bold">Install anyway</span>.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ApkDownloadButton label="Download the APK" />
          <CopyApkLink />
        </div>
      </section>

      {/* ------------------------------ SPECS ----------------------------- */}
      <section className="mb-12">
        <Header eyebrow="Details" title="The file you are getting" />
        <div className="glass grid grid-cols-1 overflow-hidden rounded-3xl sm:grid-cols-2">
          {APP_SPECS.map((row, i) => (
            <div
              key={row.label}
              className={cx(
                "flex items-center justify-between gap-4 border-b border-[var(--border-soft)] px-5 py-4",
                // The final two rows close the grid in both the 1-column and 2-column layouts.
                i >= APP_SPECS.length - 2 && "border-b-0"
              )}
            >
              <span className="text-muted text-[12.5px] font-semibold">{row.label}</span>
              <span className="min-w-0 truncate text-[13.5px] font-bold">{row.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------- FAQ ------------------------------ */}
      <section className="mb-12">
        <Header eyebrow="Questions" title="Good to know" />
        <div className="glass overflow-hidden rounded-3xl">
          {APP_FAQ.map((f, i) => (
            <details key={f.q} className={cx("group", i > 0 && "border-t border-[var(--border-soft)]")}>
              <summary className="hover-panel flex cursor-pointer list-none items-center gap-4 px-5 py-4 md:px-6">
                <span className="font-display flex-1 text-[14.5px] font-bold tracking-tight">{f.q}</span>
                <ChevronDown size={18} className="text-muted shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="text-muted -mt-1 px-5 pb-5 text-[13.5px] leading-[22px] md:px-6">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------------------------- FINAL CTA --------------------------- */}
      <section
        className="relative overflow-hidden rounded-[32px] border p-7 text-center md:p-12"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 42%, transparent)",
          background:
            "radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%), var(--bg-elev)",
          boxShadow: "0 40px 110px -50px var(--glow)",
        }}
      >
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
        />
        <div className="relative">
          <span className="text-muted text-[11px] font-bold tracking-[0.28em] uppercase">
            {ANDROID_APP.name} {ANDROID_APP.tag} · {ANDROID_APP.author}
          </span>
          <h2 className="font-display mx-auto mt-3 max-w-[22ch] text-[30px] leading-[1.05] font-extrabold tracking-tight md:text-[44px]">
            Your music, <span className="accent-text text-glow">with the screen off.</span>
          </h2>
          <p className="text-muted mx-auto mt-3 max-w-xl text-[14px] leading-6">
            {APP_SIZE_LABEL}, free, and it never asks for an account. Download the APK and let the app keep playing.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <ApkDownloadButton variant="hero" label="Download the APK" />
            <a
              href={ANDROID_APP.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ring-focus glass hover-panel flex items-center gap-2 rounded-2xl px-5 py-4 text-[14px] font-bold"
            >
              <FileText size={15} /> Release notes
            </a>
          </div>
          <p className="text-muted-2 mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] font-semibold">
            <span className="flex items-center gap-1.5">
              <WifiOff size={13} /> Works offline after download
            </span>
            <span className="flex items-center gap-1.5">
              <MoonStar size={13} /> Background playback
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} /> Straight from the GitHub release
            </span>
          </p>
          <p className="text-muted-2 mt-5 text-[12.5px]">
            Prefer no install?{" "}
            <Link href="/" className="accent-text font-semibold underline-offset-2 hover:underline">
              Keep using the web player
            </Link>{" "}
            — or add it to your home screen from the browser menu.
          </p>
        </div>
      </section>

      {/* --------------------- FLOATING MOBILE DOWNLOAD BAR --------------- */}
      <div
        className={cx(
          "fixed right-2 left-2 z-30 transition-[bottom] duration-300 md:hidden",
          hasTrack ? "bottom-[146px]" : "bottom-[74px]"
        )}
      >
        <div
          className="glass-strong flex items-center gap-3 rounded-2xl p-2.5 pl-4"
          style={{ boxShadow: "0 18px 44px -12px var(--shadow)" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold">
              {ANDROID_APP.name} {ANDROID_APP.tag}
            </span>
            <span className="text-muted-2 block text-[11px]">Free APK · {APP_SIZE_LABEL}</span>
          </span>
          <ApkDownloadButton variant="compact" label="Get the app" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bits                                                               */
/* ------------------------------------------------------------------ */

function Header({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <div className="text-muted-2 text-[10.5px] font-bold tracking-[0.24em] uppercase">{eyebrow}</div>
      <h2 className="font-display mt-1.5 text-[24px] font-extrabold tracking-tight md:text-[30px]">{title}</h2>
      {sub && <p className="text-muted mt-1.5 max-w-2xl text-[13.5px] leading-6">{sub}</p>}
    </div>
  );
}

function CopyApkLink() {
  const pushToast = useUi((s) => s.pushToast);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(ANDROID_APP.apkUrl);
      ok = true;
    } catch {
      // Older browsers / non-HTTPS contexts block the async API.
      const ta = document.createElement("textarea");
      ta.value = ANDROID_APP.apkUrl;
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
      pushToast({ title: "App link copied", desc: "Paste it in any browser to download", kind: "ok" });
    } else {
      pushToast({ title: "Copy failed", desc: ANDROID_APP.apkUrl, kind: "warn" });
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="ring-focus glass hover-panel accent-text flex items-center gap-2 rounded-2xl px-5 py-3.5 text-[14px] font-bold transition-transform hover:scale-[1.02] active:scale-95"
    >
      {copied ? <Check size={15} strokeWidth={3} /> : <Copy size={15} />}
      {copied ? "Link copied" : "Copy app link"}
    </button>
  );
}
