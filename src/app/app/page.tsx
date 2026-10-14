"use client";

import Link from "next/link";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  LayoutDashboard,
  ListMusic,
  MicVocal,
  MoonStar,
  Orbit,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Timer,
  WrapText,
} from "lucide-react";
import {
  ANDROID_APP,
  APP_COMING_SOON,
  APP_FAQ,
  APP_FEATURES,
  APP_SIZE_LABEL,
  APP_SPECS,
  APP_VERSION_LABEL,
  APP_WHATS_NEW,
  INSTALL_STEPS,
} from "@/lib/appRelease";
import { qrImagePath, shareText, shortLinkFor } from "@/lib/shortLink";
import { copyText } from "@/lib/clipboard";
import { useUi } from "@/store/ui";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui";

type IconComp = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;

const FEATURE_ICONS: Record<string, IconComp> = {
  "moon-star": MoonStar,
  "sliders-horizontal": SlidersHorizontal,
  orbit: Orbit,
  download: Download,
  "mic-vocal": MicVocal,
  "wrap-text": WrapText,
  "layout-dashboard": LayoutDashboard,
  smartphone: Smartphone,
  "list-music": ListMusic,
  sparkles: Sparkles,
  timer: Timer,
  "shield-check": ShieldCheck,
};

export default function AppDownloadPage() {

  return (
    <div className="fade-up mx-auto max-w-[1080px] px-4 pt-6 desk:px-8 desk:pt-10">
      {/* hero */}
      <section className="relative overflow-hidden rounded-[24px] bg-raised p-6 ring-1 ring-edge desk:p-10">
        <div className="pointer-events-none absolute -top-24 -right-20 h-80 w-80 rounded-full opacity-50 blur-3xl" style={{ background: "radial-gradient(closest-side, #fa2d48, transparent)" }} />
        <div className="relative grid items-center gap-8 desk:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="mb-5 flex items-center gap-4">
              <LogoMark size={72} className="shadow-[0_16px_40px_-10px_rgba(250,45,72,.55)]" />
              <div>
                <div className="t-eyebrow text-fg-2">Android app</div>
                <div className="text-[15px] font-semibold">
                  {ANDROID_APP.name} {APP_VERSION_LABEL}
                </div>
                <div className="text-[13px] text-fg-2">Released {ANDROID_APP.released}</div>
              </div>
            </div>
            <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.9px] desk:text-[52px] desk:tracking-[-1.4px]">
              Sidify, in your pocket.
            </h1>
            <p className="mt-3 max-w-[560px] text-[15.5px] leading-relaxed text-fg-2">
              Background playback that survives a locked screen, a real studio equalizer with saved presets, synced lyrics and offline downloads. Free APK, no account,
              running in about a minute.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href={ANDROID_APP.apkUrl} className="inline-flex h-12 items-center gap-2 rounded-full bg-brand px-7 text-[16px] font-semibold text-white transition-opacity hover:opacity-90">
                <Download size={18} /> Download APK
              </a>
              <span className="text-[13px] text-fg-2">
                {APP_SIZE_LABEL} · {ANDROID_APP.platform} · {ANDROID_APP.price}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-[18px] bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrImagePath(360, "svg")} alt="QR code for the APK download" className="h-[168px] w-[168px]" />
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const origin = window.location.origin;
                try {
                  await copyText(shareText(origin));
                  useUi.getState().pushToast({ title: "Link copied", desc: shortLinkFor(origin), kind: "ok" });
                } catch {
                  useUi.getState().pushToast({ title: "Couldn't copy", kind: "warn" });
                }
              }}
            >
              <Copy size={14} /> Copy download link
            </Button>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mt-12">
        <h2 className="t-section mb-4">What you get</h2>
        <div className="grid gap-3 sm:grid-cols-2 desk:grid-cols-3">
          {APP_FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.icon] ?? Sparkles;
            return (
              <div key={f.title} className="rounded-[16px] bg-fill p-4">
                <div className="flex items-center gap-2.5">
                  <Icon size={19} className="text-playing" />
                  <span className="text-[15px] font-semibold">{f.title}</span>
                  {f.soon && <span className="rounded-full bg-fill-2 px-2 py-[1px] text-[10.5px] font-bold text-fg-2">Coming soon</span>}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* what's new + install */}
      <section className="mt-12 grid gap-8 desk:grid-cols-2">
        <div>
          <h2 className="t-section mb-4">What&apos;s new in {ANDROID_APP.tag}</h2>
          <ul className="space-y-2.5">
            {APP_WHATS_NEW.map((item) => (
              <li key={item} className="flex gap-2.5 text-[14px] leading-relaxed text-fg-2">
                <Check size={16} className="mt-0.5 shrink-0 text-playing" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          {APP_COMING_SOON.map((item) => (
            <p key={item} className="mt-4 rounded-[12px] bg-fill p-3 text-[13px] text-fg-2">
              {item}
            </p>
          ))}
        </div>
        <div>
          <h2 className="t-section mb-4">Install in four steps</h2>
          <ol className="space-y-4">
            {INSTALL_STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[14px] font-bold text-on-primary">{i + 1}</span>
                <span>
                  <span className="block text-[15px] font-semibold">{s.title}</span>
                  <span className="block text-[13.5px] leading-relaxed text-fg-2">{s.desc}</span>
                </span>
              </li>
            ))}
          </ol>
          <a href={ANDROID_APP.apkUrl} className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-on-primary hover:opacity-90">
            <Download size={17} /> Download APK
          </a>
        </div>
      </section>

      {/* specs */}
      <section className="mt-12">
        <h2 className="t-section mb-4">Details</h2>
        <dl className="grid overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge sm:grid-cols-2">
          {APP_SPECS.map((row) => (
            <div key={row.label} className="flex justify-between gap-4 px-4 py-3 shadow-[inset_0_-0.5px_0_var(--hairline)]">
              <dt className="text-[14px] text-fg-2">{row.label}</dt>
              <dd className="truncate text-right text-[14px] font-medium">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* faq */}
      <section className="mt-12">
        <h2 className="t-section mb-4">Questions</h2>
        <div className="overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge">
          {APP_FAQ.map((f) => (
            <details key={f.q} className="group [&+&]:shadow-[inset_0_0.5px_0_var(--hairline)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[15px] font-medium">
                {f.q}
                <ChevronDown size={18} className="shrink-0 text-fg-2 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-[14px] leading-relaxed text-fg-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="mt-10 text-center text-[13px] text-fg-2">
        Prefer the browser? Everything keeps working right here. <Link href="/" className="font-semibold text-fg underline">Back to Sidify</Link>
      </p>
    </div>
  );
}
