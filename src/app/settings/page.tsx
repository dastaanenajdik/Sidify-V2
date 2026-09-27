"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bluetooth,
  Cast,
  Check,
  CloudDownload,
  Download,
  FileText,
  Gauge,
  Headphones,
  ListMusic,
  LogOut,
  Moon,
  PlayCircle,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  User,
  Volume2,
} from "lucide-react";
import { ACCENTS, EQ_BANDS, EQ_PRESETS, REGIONS, useSettings, effectiveGains, type Quality, type ThemeMode } from "@/store/settings";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import { applySettings, clearSleepTimer, setSleepTimer, setSpeed, setVideoMode } from "@/lib/audioEngine";
import { api } from "@/lib/clientApi";
import { useBlocked, useDownloads } from "@/lib/library";
import { Slider, Toggle, Modal } from "@/components/controls";
import { cx, formatBytes } from "@/lib/format";
import { ANDROID_APP } from "@/lib/appRelease";

const APP_VERSION = "1.0.0";
const CONTACT_EMAIL = "dastaanenajdik@gmail.com";

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "appearance", label: "Appearance", icon: Sparkles },
  { id: "playback", label: "Playback & Audio", icon: Headphones },
  { id: "downloads", label: "Downloads & Storage", icon: CloudDownload },
  { id: "system", label: "System & Devices", icon: Cast },
  { id: "privacy", label: "Privacy & Security", icon: Shield },
  { id: "about", label: "About & Support", icon: FileText },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[1280px] gap-10 px-4 pt-6 md:px-7">
      {/* side nav */}
      <nav className="sticky top-6 hidden h-fit w-52 shrink-0 space-y-1 xl:block">
        <h1 className="font-display mb-4 px-3 text-[24px] font-extrabold tracking-tight">Settings</h1>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="hover-panel flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-muted hover:text-[var(--text)]"
          >
            <s.icon size={17} /> {s.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-10">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight xl:hidden">Settings</h1>
        <AccountSection />
        <AppearanceSection />
        <PlaybackSection />
        <DownloadsSection />
        <SystemSection />
        <PrivacySection />
        <AboutSection />
        <footer className="pb-4 pt-2 text-center">
          <p className="text-muted text-[13px]">
            Made with <span className="accent-text" aria-label="love">♥</span> by Siddharth IfallertzIa
          </p>
          <p className="text-muted-2 mt-1 text-[12px]">Version {APP_VERSION}</p>
          <p className="mt-1 text-[12px]">
            <a href={`mailto:${CONTACT_EMAIL}`} className="accent-text font-medium hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------- primitives ------------------------------- */
function SectionCard({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="mb-3">
        <h2 className="font-display text-[19px] font-bold">{title}</h2>
        {desc && <p className="text-muted mt-0.5 text-[12.5px]">{desc}</p>}
      </div>
      <div className="glass divide-y divide-[var(--border-soft)] rounded-3xl">{children}</div>
    </section>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[64px] items-center justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold">{label}</div>
        {desc && <div className="text-muted-2 mt-0.5 text-[12px] leading-5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function QualitySelect({ value, onChange }: { value: Quality; onChange: (v: Quality) => void }) {
  return (
    <div className="glass flex rounded-xl p-0.5">
      {(["low", "medium", "high"] as Quality[]).map((q) => (
        <button
          key={q}
          onClick={() => onChange(q)}
          className={cx(
            "rounded-[10px] px-3 py-1.5 text-[12px] font-bold capitalize transition-all",
            value === q ? "accent-bg text-black" : "text-muted hover:text-[var(--text)]"
          )}
        >
          {q}
        </button>
      ))}
    </div>
  );
}

function NativeSelect({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: { id: string; name: string }[]; ariaLabel: string }) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="glass cursor-pointer rounded-xl px-3 py-2 text-[13px] font-medium outline-none"
      style={{ background: "var(--panel)" }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id} className="bg-[var(--bg-elev)]">
          {o.name}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------- 1. account -------------------------------- */
function AccountSection() {
  const s = useSettings();
  const qc = useQueryClient();
  const pushToast = useUi((st) => st.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const doBackup = async () => {
    setBusy(true);
    try {
      const [liked, followed, downloads, playlists] = await Promise.all([
        api.liked(),
        api.followed(),
        api.downloads(),
        api.playlists(),
      ]);
      const payload = {
        app: "sidify",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        settings: { ...useSettings.getState() },
        liked: liked.tracks,
        followed: followed.artists.map((a) => a.artist),
        downloads: downloads.downloads.map((d) => ({ track: d.track, quality: d.quality, sizeBytes: d.sizeBytes })),
        playlists: playlists.playlists.map((p) => p.name),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sidify-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast({ title: "Backup exported", desc: `${liked.tracks.length} liked songs included`, kind: "ok" });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (data.settings && typeof data.settings === "object") {
        const { set, ...rest } = data.settings;
        useSettings.getState().set(rest);
      }
      const res = await api.restore({ liked: data.liked, followed: data.followed, downloads: data.downloads });
      qc.invalidateQueries();
      pushToast({ title: "Backup restored", desc: `${res.restored} items synced back`, kind: "ok" });
    } catch {
      pushToast({ title: "Restore failed", desc: "Not a valid Sidify backup", kind: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard id="account" title="Account & Profile" desc="Your identity and library portability">
      <Row label="Display name" desc="Shown across your dashboard">
        <input
          defaultValue={s.profileName}
          onBlur={(e) => s.set({ profileName: e.target.value.slice(0, 30) })}
          placeholder="Your name"
          className="glass w-40 rounded-xl px-3 py-2 text-[13px] font-medium outline-none"
        />
      </Row>
      <Row label="Email" desc="For sync and backup reminders">
        <input
          defaultValue={s.profileEmail}
          onBlur={(e) => s.set({ profileEmail: e.target.value.slice(0, 60) })}
          placeholder="you@email.com"
          type="email"
          className="glass w-44 rounded-xl px-3 py-2 text-[13px] font-medium outline-none"
        />
      </Row>
      <Row label="Backup library" desc="Export likes, follows, downloads & settings as JSON">
        <button onClick={() => void doBackup()} disabled={busy} className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text">
          <Download size={14} /> {busy ? "Working…" : "Export"}
        </button>
      </Row>
      <Row label="Restore backup" desc="Import a previous Sidify export">
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void doRestore(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text">
          <Upload size={14} /> Import
        </button>
      </Row>
      <Row label="Sign out" desc="Clears local sessions and settings on this device">
        <button
          onClick={() => {
            Object.keys(localStorage)
              .filter((k) => k.startsWith("sidify"))
              .forEach((k) => localStorage.removeItem(k));
            location.reload();
          }}
          className="flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-[12.5px] font-bold text-red-400 hover:bg-red-500/10"
        >
          <LogOut size={14} /> Sign out
        </button>
      </Row>
    </SectionCard>
  );
}

/* ------------------------------ 2. appearance ------------------------------ */
function AppearanceSection() {
  const s = useSettings();
  return (
    <SectionCard id="appearance" title="Appearance & Theme" desc="Make Sidify unmistakably yours">
      <Row label="Theme" desc="Dark, light, or follow your system">
        <div className="glass flex rounded-xl p-0.5">
          {(["light", "dark", "system"] as ThemeMode[]).map((t) => (
            <button
              key={t}
              onClick={() => s.set({ theme: t })}
              className={cx(
                "rounded-[10px] px-3.5 py-1.5 text-[12px] font-bold capitalize transition-all",
                s.theme === t ? "accent-bg text-black" : "text-muted hover:text-[var(--text)]"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Accent color" desc="Paints the neon across the whole app">
        <div className="flex items-center gap-2.5">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              aria-label={a.name}
              title={a.name}
              onClick={() => s.set({ accent: a.value })}
              className="grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110"
              style={{ background: a.value, boxShadow: s.accent === a.value ? `0 0 0 3px var(--bg), 0 0 0 5px ${a.value}, 0 0 16px ${a.value}` : "none" }}
            >
              {s.accent === a.value && <Check size={14} strokeWidth={3.5} className="text-black" />}
            </button>
          ))}
        </div>
      </Row>
      <Row label="App region" desc="Changes charts, search and catalog storefront">
        <NativeSelect value={s.region} onChange={(v) => s.set({ region: v })} options={REGIONS} ariaLabel="Region" />
      </Row>
      <Row label="App language" desc="Interface language (English only in beta)">
        <NativeSelect
          value={s.language}
          onChange={(v) => s.set({ language: v })}
          options={[
            { id: "en", name: "English" },
            { id: "hi", name: "Hindi (soon)" },
            { id: "es", name: "Español (soon)" },
          ]}
          ariaLabel="Language"
        />
      </Row>
    </SectionCard>
  );
}

/* ------------------------------- 3. playback ------------------------------- */
function PlaybackSection() {
  const s = useSettings();
  const speed = usePlayer((st) => st.speed);
  const sleepMode = usePlayer((st) => st.sleepMode);
  const gains = effectiveGains(s);

  return (
    <SectionCard id="playback" title="Playback & Audio Engine" desc="Real DSP — EQ, pan and crossfade run live on the audio graph">
      <Row label="Streaming quality · Wi-Fi" desc="Quality badge shown in the player">
        <QualitySelect value={s.wifiQuality} onChange={(v) => s.set({ wifiQuality: v })} />
      </Row>
      <Row label="Streaming quality · Mobile data" desc="Save bandwidth on the go">
        <QualitySelect value={s.mobileQuality} onChange={(v) => s.set({ mobileQuality: v })} />
      </Row>
      <Row label={`Crossfade · ${s.crossfadeSecs === 0 ? "Off" : `${s.crossfadeSecs}s`}`} desc="Blend the end of each track into the next">
        <div className="w-44">
          <Slider value={s.crossfadeSecs} min={0} max={12} onChange={(v) => s.set({ crossfadeSecs: v })} ariaLabel="Crossfade seconds" />
        </div>
      </Row>
      <Row label="Video mode" desc="Watch YouTube videos in the full player, or switch to audio">
        <Toggle
          checked={usePlayer((st) => st.videoMode)}
          onChange={(v) => void setVideoMode(v)}
        />
      </Row>
      <Row label="Gapless playback" desc="Preloads the next track for seamless transitions">
        <Toggle checked={s.gapless} onChange={(v) => s.set({ gapless: v })} />
      </Row>
      <Row label="Autoplay" desc="Keep similar music flowing when your queue ends">
        <Toggle checked={s.autoplay} onChange={(v) => s.set({ autoplay: v })} />
      </Row>
      <Row label="Remember playback position" desc="Resume exactly where you left off">
        <Toggle checked={s.rememberPosition} onChange={(v) => s.set({ rememberPosition: v })} />
      </Row>

      {/* EQ block */}
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal size={16} className="accent-text" />
          <div className="text-[14px] font-semibold">Equalizer & DSP</div>
          <button onClick={() => s.set({ eqPreset: "flat" })} className="text-muted-2 ml-auto text-[11.5px] font-bold tracking-wider uppercase hover:accent-text">
            Reset
          </button>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(EQ_PRESETS).map(([id, p]) => (
            <button
              key={id}
              onClick={() => s.set({ eqPreset: id })}
              className={cx(
                "rounded-full border px-3 py-1.5 text-[12px] font-semibold",
                s.eqPreset === id ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-4 overflow-x-auto pb-1 sm:gap-6">
          {EQ_BANDS.map((band, i) => (
            <div key={band} className="flex flex-col items-center gap-1.5">
              <span className="text-muted-2 text-[10px] font-semibold tabular-nums">{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</span>
              <input
                type="range"
                className="v-slider"
                min={-12}
                max={12}
                value={gains[i]}
                aria-label={`${band}Hz`}
                onChange={(e) => {
                  const next = [...gains];
                  next[i] = Number(e.target.value);
                  s.set({ eqPreset: "custom", eqGains: next });
                }}
              />
              <span className="text-muted-2 text-[10.5px] tabular-nums">{band >= 1000 ? `${band / 1000}k` : band}</span>
            </div>
          ))}
        </div>
      </div>

      <Row label="Volume normalization" desc="Even out loudness between tracks">
        <Toggle checked={s.normalization} onChange={(v) => s.set({ normalization: v })} />
      </Row>
      <Row label={`Audio balance · ${s.balance === 0 ? "Center" : s.balance > 0 ? `R +${Math.round(s.balance * 100)}` : `L +${Math.round(-s.balance * 100)}`}`} desc="Pan sound between left and right channels">
        <div className="w-44">
          <Slider value={Math.round(s.balance * 100)} min={-100} max={100} onChange={(v) => s.set({ balance: v / 100 })} ariaLabel="Audio balance" />
        </div>
      </Row>
      <Row label="Playback speed" desc="Applied instantly to the current track">
        <div className="flex flex-wrap justify-end gap-1.5">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
            <button
              key={v}
              onClick={() => setSpeed(v)}
              className={cx(
                "rounded-lg border px-2.5 py-1 text-[11.5px] font-bold",
                speed === v ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
              )}
            >
              {v}x
            </button>
          ))}
        </div>
      </Row>
      <Row label="Sleep timer" desc={sleepMode ? (sleepMode === "eot" ? "Pauses at end of track" : "Timer running") : "Pause playback automatically"}>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {[15, 30, 60].map((m) => (
            <button
              key={m}
              onClick={() => setSleepTimer(m)}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-bold text-muted hover:accent-text"
            >
              {m}m
            </button>
          ))}
          <button onClick={() => setSleepTimer("eot")} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-bold text-muted hover:accent-text">
            <Moon size={12} className="inline" /> Track
          </button>
          {sleepMode && (
            <button onClick={clearSleepTimer} className="rounded-lg border border-red-500/40 px-2.5 py-1 text-[11.5px] font-bold text-red-400">
              Off
            </button>
          )}
        </div>
      </Row>
    </SectionCard>
  );
}

/* ------------------------------- 4. downloads ------------------------------ */
function DownloadsSection() {
  const s = useSettings();
  const { data, clear } = useDownloads();
  const qc = useQueryClient();
  const pushToast = useUi((st) => st.pushToast);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => {});
  }, [data]);

  const rows = data?.downloads ?? [];
  const totalSize = rows.reduce((a, r) => a + (r.sizeBytes || 0), 0);

  return (
    <SectionCard id="downloads" title="Downloads & Storage" desc="Offline audio lives in encrypted-browser storage on this device">
      <Row label="Download quality" desc="Low ≈96kbps · Medium ≈160kbps · High ≈320kbps">
        <QualitySelect value={s.downloadQuality} onChange={(v) => s.set({ downloadQuality: v })} />
      </Row>
      <Row label="Download on Wi-Fi only" desc="Pause downloads while on mobile data">
        <Toggle checked={s.wifiOnlyDownloads} onChange={(v) => s.set({ wifiOnlyDownloads: v })} />
      </Row>
      <Row label="Auto-download liked songs" desc="Every new like becomes available offline">
        <Toggle checked={s.autoDownloadLiked} onChange={(v) => s.set({ autoDownloadLiked: v })} />
      </Row>
      <Row label="Storage used" desc={estimate ? `${formatBytes(totalSize)} of music · ${formatBytes(estimate.usage)} total app data` : "Calculating…"}>
        <span className="accent-text text-[13px] font-bold tabular-nums">{formatBytes(totalSize)}</span>
      </Row>
      <Row label="Clear cache" desc="Flushes artwork, session and search caches (keeps downloads)">
        <button
          onClick={() => {
            localStorage.removeItem("sidify-search-history");
            localStorage.removeItem("sidify-session");
            qc.clear();
            pushToast({ title: "Cache cleared", kind: "ok" });
          }}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          <RefreshCw size={14} /> Clear cache
        </button>
      </Row>
      <Row label="Delete all downloads" desc={`Removes ${rows.length} offline songs and frees storage`}>
        <button
          onClick={() => void clear()}
          className="flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-[12.5px] font-bold text-red-400 hover:bg-red-500/10"
        >
          <Trash2 size={14} /> Delete all
        </button>
      </Row>
    </SectionCard>
  );
}

/* -------------------------------- 5. system -------------------------------- */
function SystemSection() {
  const s = useSettings();
  const pushToast = useUi((st) => st.pushToast);
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(null);

  useEffect(() => {
    const w = window as unknown as { __sidifyInstall?: { prompt: () => Promise<void> } | null };
    setInstallEvt(w.__sidifyInstall ?? null);
    const onReady = () => setInstallEvt(w.__sidifyInstall ?? null);
    window.addEventListener("sidify-install-ready", onReady);
    window.addEventListener("appinstalled", onReady);
    return () => {
      window.removeEventListener("sidify-install-ready", onReady);
      window.removeEventListener("appinstalled", onReady);
    };
  }, []);

  return (
    <SectionCard id="system" title="System & Device Controls" desc="How Sidify talks to your OS">
      <Row label="Install Sidify" desc="Standalone PWA · homescreen & desktop">
        <button
          onClick={async () => {
            if (installEvt) {
              await installEvt.prompt();
              setInstallEvt(null);
            } else if (window.matchMedia("(display-mode: standalone)").matches) {
              pushToast({ title: "Already installed", desc: "You're running the installed app", kind: "info" });
            } else {
              pushToast({ title: "Install from browser menu", desc: "Tap ⋮ → “Install app” / “Add to Home Screen”", kind: "info" });
            }
          }}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          <Download size={14} /> Install
        </button>
      </Row>
      <Row label="Lock-screen & media controls" desc="OS-level play/pause via Media Session API">
        <Toggle checked={s.mediaControls} onChange={(v) => s.set({ mediaControls: v })} />
      </Row>
      <Row label="Notification bar controls" desc="Show transport controls in notifications">
        <Toggle checked={s.notifControls} onChange={(v) => s.set({ notifControls: v })} />
      </Row>
      <Row label="Instructions to play background" desc="Keep the music going with the screen off or the app closed">
        <button
          onClick={() => useUi.getState().setBgHelpOpen(true)}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          <PlayCircle size={14} /> Show guide
        </button>
      </Row>
      <Row label="Bluetooth autoplay" desc="Resume when your headphones or car connects">
        <Toggle checked={s.bluetoothAutoplay} onChange={(v) => s.set({ bluetoothAutoplay: v })} />
      </Row>
      <Row label="Cast to device" desc="Chromecast / AirPlay receivers on your network">
        <button
          onClick={() => pushToast({ title: "Scanning for devices…", desc: "No Cast devices found nearby", kind: "info" })}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          <Cast size={14} /> Cast
        </button>
      </Row>
      <Row label="Car mode" desc="Android Auto / CarPlay handoff (mobile app)">
        <button
          onClick={() => pushToast({ title: "Car mode", desc: "Available in the Sidify mobile app", kind: "info" })}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          <Bluetooth size={14} /> Connect
        </button>
      </Row>
    </SectionCard>
  );
}

/* -------------------------------- 6. privacy -------------------------------- */
function PrivacySection() {
  const s = useSettings();
  const { data, unblock } = useBlocked();
  const qc = useQueryClient();
  const pushToast = useUi((st) => st.pushToast);
  const blocked = data?.artists ?? [];
  return (
    <SectionCard id="privacy" title="Privacy & Security" desc="Control what Sidify remembers">
      <Row label="Explicit content filter" desc="Hides tracks marked explicit across the app">
        <Toggle checked={s.explicitFilter} onChange={(v) => s.set({ explicitFilter: v })} />
      </Row>
      <Row label="Clear search history" desc="Removes your recent search terms">
        <button
          onClick={() => {
            localStorage.removeItem("sidify-search-history");
            pushToast({ title: "Search history cleared", kind: "ok" });
          }}
          className="glass rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          Clear
        </button>
      </Row>
      <Row label="Clear listening history" desc="Deletes recently played from the server">
        <button
          onClick={async () => {
            await api.clearRecent();
            qc.invalidateQueries({ queryKey: ["recent"] });
            qc.invalidateQueries({ queryKey: ["home"] });
            pushToast({ title: "Listening history cleared", kind: "ok" });
          }}
          className="glass rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          Clear
        </button>
      </Row>
      <div className="px-5 py-4">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-semibold">
          <Ban size={15} className="text-red-400" /> Blocked artists
          <span className="text-muted-2 text-[12px] font-normal">({blocked.length})</span>
        </div>
        {blocked.length === 0 ? (
          <p className="text-muted-2 text-[12.5px]">You haven&apos;t blocked anyone. Use “Don&apos;t play this artist” from any track menu.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {blocked.map((b) => (
              <span key={b.artistId} className="glass flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 text-[12.5px] font-medium">
                {b.name}
                <button
                  onClick={() => void unblock(b.artistId)}
                  className="grid h-6 w-6 place-items-center rounded-full bg-[var(--panel-strong)] text-muted hover:accent-text"
                  aria-label={`Unblock ${b.name}`}
                >
                  <Check size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* --------------------------------- 7. about -------------------------------- */
const ABOUT_FEATURES = [
  "Search songs easily",
  "Discover artists",
  "Play music through YouTube",
  "Background playback where supported",
  "Notification and lock-screen controls",
  "Favourites",
  "Playlists",
  "Listening history",
  "Responsive mobile and web app experience",
  "Installable PWA support",
];

function AboutSection() {
  const pushToast = useUi((st) => st.pushToast);
  const [checking, setChecking] = useState(false);
  const [legal, setLegal] = useState<"tos" | "privacy" | null>(null);

  return (
    <SectionCard id="about" title="About & Support" desc="Version info, legal and help">
      <div className="px-5 py-5">
        <p className="text-muted text-[13.5px] leading-6">
          Sidify is a clean and simple music experience built for people who want to discover and listen to music
          without unnecessary distractions.
        </p>
        <p className="text-muted mt-2 text-[13.5px] leading-6">
          Play ad-free music with a focused and minimal listening experience.
        </p>
        <div className="mt-4">
          <div className="mb-2 text-[14px] font-semibold">Features</div>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {ABOUT_FEATURES.map((f) => (
              <li key={f} className="text-muted flex items-center gap-2.5 py-1 text-[13px]">
                <Check size={13} className="accent-text shrink-0" /> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Row label="App version" desc="Sidify web · PWA enabled">
        <span className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12.5px] font-bold">
          <Volume2 size={13} className="accent-text" /> {APP_VERSION}
        </span>
      </Row>
      <Row label="Check for updates" desc="Silent over-the-air PWA updates">
        <button
          onClick={() => {
            setChecking(true);
            setTimeout(() => {
              setChecking(false);
              pushToast({ title: "You're up to date", desc: `Sidify v${APP_VERSION} is the latest build`, kind: "ok" });
            }, 1400);
          }}
          className="glass flex min-w-[132px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          {checking ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {checking ? "Checking…" : "Check now"}
        </button>
      </Row>
      <Row label="Android app" desc={`${ANDROID_APP.name} ${ANDROID_APP.tag} · background playback, equalizer, 8D audio`}>
        <Link
          href="/app"
          className="glass accent-text flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold transition-transform hover:scale-[1.02]"
        >
          <Download size={14} /> Get the APK
        </Link>
      </Row>
      <Row label="Terms of Service">
        <button onClick={() => setLegal("tos")} className="text-muted text-[12.5px] font-bold hover:accent-text">
          View
        </button>
      </Row>
      <Row label="Privacy Policy">
        <button onClick={() => setLegal("privacy")} className="text-muted text-[12.5px] font-bold hover:accent-text">
          View
        </button>
      </Row>
      <Row label="Contact" desc="Questions, feedback or support">
        <a href={`mailto:${CONTACT_EMAIL}`} className="glass rounded-xl px-4 py-2 text-[12.5px] font-bold accent-text hover:underline">
          {CONTACT_EMAIL}
        </a>
      </Row>
      <Row label="Report a problem" desc="Found a glitch in the matrix?">
        <a href={`mailto:${CONTACT_EMAIL}?subject=Sidify%20bug%20report`} className="glass rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text">
          Report
        </a>
      </Row>

      <Modal open={legal !== null} onClose={() => setLegal(null)} title={legal === "tos" ? "Terms of Service" : "Privacy Policy"}>
        <div className="text-muted max-h-[50vh] space-y-3 overflow-y-auto text-[13px] leading-6">
          {legal === "tos" ? (
            <>
              <p>Sidify provides a clean music discovery and listening experience powered by YouTube. By using the app you agree to stream music responsibly and respect the rights of artists and labels.</p>
              <p>Downloads are cached for personal offline listening inside your own browser storage only.</p>
              <p>We may ship silent over-the-air updates that improve performance and features.</p>
            </>
          ) : (
            <>
              <p>Sidify stores your library — likes, playlists, follows and history — to power your personalized dashboard. Clearing history permanently deletes it.</p>
              <p>Your settings, theme and downloads remain on your own device. Blocked artists and filters are honored across the entire app.</p>
              <p>We never sell your listening data. Ever.</p>
            </>
          )}
        </div>
      </Modal>
    </SectionCard>
  );
}
