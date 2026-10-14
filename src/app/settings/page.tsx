"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Download,
  Gauge,
  HardDrive,
  Info,
  Languages,
  LogOut,
  Mail,
  MonitorPlay,
  Moon,
  Music2,
  Palette,
  RefreshCw,
  Repeat,
  Shield,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from "lucide-react";
import { REGIONS, useSettings, type Quality, type ThemeMode } from "@/store/settings";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import { setSpeed, setVideoMode } from "@/lib/audioEngine";
import { api } from "@/lib/clientApi";
import { useBlocked, useDownloads } from "@/lib/library";
import { clearPlayLog } from "@/lib/playLog";
import { leaveRoom, useRoomSummary } from "@/lib/rooms/client";
import { formatBytes } from "@/lib/format";
import { ANDROID_APP, APP_SIZE_LABEL } from "@/lib/appRelease";
import { checkForUpdate } from "@/lib/pwa";
import { Button, Chips, Group, GroupRow, PageTitle, Range, Sheet, Switch } from "@/components/ui";
import { InfinityGlyph, LyricsGlyph, PeopleGlyph } from "@/components/icons";
import { LogoMark } from "@/components/Logo";
import { EqBlock, SleepBlock } from "@/components/player/PlaybackSheet";

const APP_VERSION = "2.0.0";
/** Vercel commit SHA — lets About prove which build a device is running. */
const BUILD_ID = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);
const CONTACT_EMAIL = "dastaanenajdik@gmail.com";

const QUALITY: { id: Quality; label: string }[] = [
  { id: "low", label: "Data saver" },
  { id: "medium", label: "Standard" },
  { id: "high", label: "High" },
];

const SECTIONS = [
  ["profile", "Profile"],
  ["appearance", "Appearance"],
  ["playback", "Playback"],
  ["lyrics", "Lyrics"],
  ["together", "Listen Together"],
  ["storage", "Downloads & storage"],
  ["privacy", "Privacy"],
  ["backup", "Backup"],
  ["about", "About"],
] as const;

export default function SettingsPage() {
  return (
    <div className="fade-up">
      <PageTitle>Settings</PageTitle>
      <div className="flex gap-10 px-4 desk:px-8">
        <nav className="sticky top-6 hidden h-fit w-44 shrink-0 space-y-0.5 xl:block" aria-label="Settings sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-[7px] px-2.5 py-1.5 text-[14px] text-fg-2 hover:bg-fill hover:text-fg">
              {label}
            </a>
          ))}
        </nav>
        <div className="mx-auto w-full max-w-[720px] min-w-0 xl:mx-0">
          <Profile />
          <Appearance />
          <Playback />
          <Lyrics />
          <Together />
          <Storage />
          <Privacy />
          <Backup />
          <About />
          <footer className="py-8 text-center">
            <LogoMark size={36} className="mx-auto" />
            <p className="mt-3 text-[13px] text-fg-2">
              Made with <span className="text-playing">♥</span> by Siddharth IfallertzIa
            </p>
            <p className="mt-1 text-[12px] text-fg-3">
              Sidify {APP_VERSION}
              {BUILD_ID ? ` · ${BUILD_ID}` : ""}
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Anchor({ id }: { id: string }) {
  return <span id={id} className="block scroll-mt-6" />;
}

/* --------------------------------- profile -------------------------------- */

function Profile() {
  const s = useSettings();
  return (
    <>
      <Anchor id="profile" />
      <div className="mb-7 flex items-center gap-4 rounded-[14px] bg-raised/80 p-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 text-[26px] font-bold text-white">
          {(s.profileName || "S").charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            defaultValue={s.profileName}
            onBlur={(e) => s.set({ profileName: e.target.value.trim().slice(0, 24) })}
            placeholder="Your name"
            aria-label="Display name"
            className="field h-10 w-full text-[16px] font-semibold"
          />
          <input
            defaultValue={s.profileEmail}
            onBlur={(e) => s.set({ profileEmail: e.target.value.trim().slice(0, 60) })}
            placeholder="Email (optional)"
            type="email"
            aria-label="Email"
            className="field h-9 w-full"
          />
        </div>
      </div>
    </>
  );
}

/* ------------------------------- appearance ------------------------------- */

function Appearance() {
  const s = useSettings();
  return (
    <>
      <Anchor id="appearance" />
      <Group header="Appearance" footer="Colour from the artwork tints the player, the page backdrop and album headers.">
        <GroupRow
          icon={<Moon size={18} />}
          title="Theme"
          trailing={
            <Chips<ThemeMode>
              size="sm"
              value={s.theme}
              onChange={(v) => s.set({ theme: v })}
              options={[
                { id: "dark", label: "Dark" },
                { id: "light", label: "Light" },
                { id: "system", label: "Auto" },
              ]}
            />
          }
        />
        <GroupRow icon={<Palette size={18} />} title="Colour from artwork" trailing={<Switch checked={s.dynamicColor} onChange={(v) => s.set({ dynamicColor: v })} label="Colour from artwork" />} />
        <GroupRow icon={<Wand2 size={18} />} title="Reduce motion" subtitle="No artwork breathing, lyric blur or drifting colours" trailing={<Switch checked={s.reduceMotion} onChange={(v) => s.set({ reduceMotion: v })} label="Reduce motion" />} />
        <GroupRow
          icon={<Languages size={18} />}
          title="Region"
          subtitle="Charts, search and new releases"
          trailing={
            <select value={s.region} onChange={(e) => s.set({ region: e.target.value })} aria-label="Region" className="field h-9 max-w-[170px] pr-2">
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          }
        />
      </Group>
    </>
  );
}

/* -------------------------------- playback -------------------------------- */

function Playback() {
  const s = useSettings();
  const speed = usePlayer((st) => st.speed);
  const videoMode = usePlayer((st) => st.videoMode);
  return (
    <>
      <Anchor id="playback" />
      <Group header="Playback">
        <GroupRow
          icon={<InfinityGlyph size={18} />}
          title="AutoPlay"
          subtitle="When the queue ends, keep similar music playing — lined up early so you can see what's next"
          trailing={<Switch checked={s.autoplay} onChange={(v) => s.set({ autoplay: v })} label="AutoPlay" />}
        />
        <GroupRow
          icon={<Sparkles size={18} />}
          title="Follow YouTube Music's radio"
          subtitle="AutoPlay uses the exact songs YouTube Music would play next"
          trailing={<Switch checked={s.ytRadio} onChange={(v) => s.set({ ytRadio: v })} label="YouTube Music radio" />}
        />
        <GroupRow icon={<Repeat size={18} />} title="Gapless playback" subtitle="Preload the next song" trailing={<Switch checked={s.gapless} onChange={(v) => s.set({ gapless: v })} label="Gapless" />} />
        <GroupRow
          icon={<Music2 size={18} />}
          title={`Crossfade · ${s.crossfadeSecs ? `${s.crossfadeSecs}s` : "Off"}`}
          subtitle="Blend the end of each song into the next"
          trailing={<Range label="Crossfade seconds" value={s.crossfadeSecs} min={0} max={12} onChange={(v) => s.set({ crossfadeSecs: v })} className="w-36" />}
        />
        <GroupRow icon={<MonitorPlay size={18} />} title="Video mode" subtitle="Watch the music video in the player" trailing={<Switch checked={videoMode} onChange={(v) => void setVideoMode(v)} label="Video mode" />} />
        <GroupRow icon={<RefreshCw size={18} />} title="Resume where you left off" trailing={<Switch checked={s.rememberPosition} onChange={(v) => s.set({ rememberPosition: v })} label="Remember position" />} />
      </Group>

      <Group header="Sound">
        <GroupRow
          icon={<Gauge size={18} />}
          title="Streaming quality · Wi-Fi"
          trailing={<Chips<Quality> size="sm" value={s.wifiQuality} options={QUALITY} onChange={(v) => s.set({ wifiQuality: v })} />}
        />
        <GroupRow
          icon={<Smartphone size={18} />}
          title="Streaming quality · Mobile"
          trailing={<Chips<Quality> size="sm" value={s.mobileQuality} options={QUALITY} onChange={(v) => s.set({ mobileQuality: v })} />}
        />
        <GroupRow icon={<Volume2 size={18} />} title="Volume normalization" subtitle="Even out loudness between songs" trailing={<Switch checked={s.normalization} onChange={(v) => s.set({ normalization: v })} label="Normalization" />} />
        <GroupRow
          title={`Balance · ${s.balance === 0 ? "Centre" : s.balance > 0 ? `R ${Math.round(s.balance * 100)}` : `L ${Math.round(-s.balance * 100)}`}`}
          trailing={<Range label="Balance" value={Math.round(s.balance * 100)} min={-100} max={100} onChange={(v) => s.set({ balance: v / 100 })} className="w-36" />}
        />
        <GroupRow
          title="Speed"
          trailing={
            <Chips
              size="sm"
              value={String(speed)}
              options={[0.75, 1, 1.25, 1.5, 2].map((v) => ({ id: String(v), label: `${v}×` }))}
              onChange={(v) => setSpeed(Number(v))}
            />
          }
        />
        <div className="space-y-6 px-4 py-4">
          <SleepBlock />
          <EqBlock />
        </div>
      </Group>
    </>
  );
}

/* --------------------------------- lyrics --------------------------------- */

function Lyrics() {
  const s = useSettings();
  return (
    <>
      <Anchor id="lyrics" />
      <Group header="Lyrics" footer="Timed lyrics light up line by line. Each song's timing can be nudged from the lyrics view.">
        <GroupRow icon={<LyricsGlyph size={18} />} title="Prefer timed lyrics" trailing={<Switch checked={s.lyricsSynced} onChange={(v) => s.set({ lyricsSynced: v })} label="Timed lyrics" />} />
        <GroupRow
          title="Text size"
          trailing={
            <Chips
              size="sm"
              value={s.lyricsSize}
              onChange={(v) => s.set({ lyricsSize: v })}
              options={[
                { id: "s", label: "Small" },
                { id: "m", label: "Medium" },
                { id: "l", label: "Large" },
              ]}
            />
          }
        />
        <GroupRow title="Lyrics finder" subtitle="Look up the words to any song" href="/library/lyrics" chevron />
      </Group>
    </>
  );
}

/* ----------------------------- listen together ---------------------------- */

function Together() {
  const room = useRoomSummary();
  return (
    <>
      <Anchor id="together" />
      <Group header="Listen Together" footer="Your display name is what others see in a room. Rooms close by themselves once everyone has left.">
        <GroupRow
          icon={<PeopleGlyph size={18} />}
          title={room.inRoom && room.room ? room.room.name : "Not in a room"}
          subtitle={room.inRoom ? `Code ${room.code} · ${room.count} listening` : "Start one or join with a code"}
          href={room.code ? `/rooms/${room.code}` : "/rooms"}
          chevron
        />
        {room.inRoom && <GroupRow icon={<LogOut size={18} />} title="Leave the room" danger onClick={() => void leaveRoom()} />}
      </Group>
    </>
  );
}

/* --------------------------------- storage -------------------------------- */

function Storage() {
  const s = useSettings();
  const { data, clear } = useDownloads();
  const qc = useQueryClient();
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => {});
  }, [data]);
  const rows = data?.downloads ?? [];
  const total = rows.reduce((a, r) => a + (r.sizeBytes || 0), 0);
  return (
    <>
      <Anchor id="storage" />
      <Group header="Downloads & storage">
        <GroupRow icon={<Download size={18} />} title="Download quality" trailing={<Chips<Quality> size="sm" value={s.downloadQuality} options={QUALITY} onChange={(v) => s.set({ downloadQuality: v })} />} />
        <GroupRow title="Download on Wi-Fi only" trailing={<Switch checked={s.wifiOnlyDownloads} onChange={(v) => s.set({ wifiOnlyDownloads: v })} label="Wi-Fi only" />} />
        <GroupRow title="Download songs you love" subtitle="Every new like becomes available offline" trailing={<Switch checked={s.autoDownloadLiked} onChange={(v) => s.set({ autoDownloadLiked: v })} label="Auto-download liked" />} />
        <GroupRow
          icon={<HardDrive size={18} />}
          title="Storage used"
          subtitle={estimate ? `${formatBytes(total)} of music · ${formatBytes(estimate.usage)} app data` : "Calculating…"}
        />
        <GroupRow
          title="Clear cache"
          subtitle="Artwork, session and search caches — keeps your downloads"
          onClick={() => {
            localStorage.removeItem("sidify-session");
            qc.clear();
            useUi.getState().pushToast({ title: "Cache cleared", kind: "ok" });
          }}
        />
        {rows.length > 0 && <GroupRow icon={<Trash2 size={18} />} title={`Delete all downloads (${rows.length})`} danger onClick={() => void clear()} />}
      </Group>
    </>
  );
}

/* --------------------------------- privacy -------------------------------- */

function Privacy() {
  const s = useSettings();
  const { data, unblock } = useBlocked();
  const qc = useQueryClient();
  const toast = useUi((st) => st.pushToast);
  const blocked = data?.artists ?? [];
  return (
    <>
      <Anchor id="privacy" />
      <Group header="Privacy">
        <GroupRow icon={<Shield size={18} />} title="Hide explicit songs" trailing={<Switch checked={s.explicitFilter} onChange={(v) => s.set({ explicitFilter: v })} label="Explicit filter" />} />
        <GroupRow
          title="Clear search history"
          onClick={() => {
            localStorage.removeItem("sidify-search-history");
            toast({ title: "Search history cleared", kind: "ok" });
          }}
        />
        <GroupRow
          title="Clear listening history"
          onClick={async () => {
            await api.clearRecent();
            qc.invalidateQueries({ queryKey: ["recent"] });
            qc.invalidateQueries({ queryKey: ["home"] });
            toast({ title: "Listening history cleared", kind: "ok" });
          }}
        />
        <GroupRow
          title="Reset Replay"
          subtitle="Forget the minutes and top songs counted on this device"
          onClick={() => {
            clearPlayLog();
            toast({ title: "Replay reset", kind: "ok" });
          }}
        />
      </Group>
      <Group header={`Blocked artists (${blocked.length})`} footer="Use “Don't play this artist” from any song's menu.">
        {blocked.length === 0 ? (
          <GroupRow icon={<Ban size={18} />} title="Nobody blocked" />
        ) : (
          blocked.map((b) => (
            <GroupRow
              key={b.artistId}
              icon={<Ban size={18} />}
              title={b.name}
              trailing={
                <Button size="sm" variant="secondary" onClick={() => void unblock(b.artistId)}>
                  Unblock
                </Button>
              }
            />
          ))
        )}
      </Group>
    </>
  );
}

/* --------------------------------- backup --------------------------------- */

function Backup() {
  const qc = useQueryClient();
  const toast = useUi((st) => st.pushToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const doBackup = async () => {
    setBusy(true);
    try {
      const [liked, followed, downloads, playlists] = await Promise.all([api.liked(), api.followed(), api.downloads().catch(() => ({ downloads: [] })), api.playlists()]);
      const settings = { ...useSettings.getState() } as Record<string, unknown>;
      delete settings.set;
      const payload = {
        app: "sidify",
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        settings,
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
      toast({ title: "Backup exported", desc: `${liked.tracks.length} liked songs included`, kind: "ok" });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (data.settings && typeof data.settings === "object") {
        const rest = { ...data.settings };
        delete rest.set;
        useSettings.getState().set(rest);
      }
      const res = await api.restore({ liked: data.liked, followed: data.followed, downloads: data.downloads });
      qc.invalidateQueries();
      toast({ title: "Backup restored", desc: `${res.restored} items synced back`, kind: "ok" });
    } catch {
      toast({ title: "Restore failed", desc: "Not a valid Sidify backup", kind: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Anchor id="backup" />
      <Group header="Backup" footer="Sign out clears Sidify's data on this device only.">
        <GroupRow icon={<Download size={18} />} title={busy ? "Working…" : "Export backup"} subtitle="Likes, follows and settings as a JSON file" onClick={() => void doBackup()} />
        <GroupRow icon={<Upload size={18} />} title="Restore backup" subtitle="Import a Sidify export" onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void doRestore(e.target.files[0])} />
        <GroupRow
          icon={<LogOut size={18} />}
          title="Sign out"
          danger
          onClick={() => {
            Object.keys(localStorage)
              .filter((k) => k.startsWith("sidify"))
              .forEach((k) => localStorage.removeItem(k));
            location.reload();
          }}
        />
      </Group>
    </>
  );
}

/* ---------------------------------- about --------------------------------- */

function About() {
  const toast = useUi((st) => st.pushToast);
  const [checking, setChecking] = useState(false);
  const [legal, setLegal] = useState<"tos" | "privacy" | null>(null);
  const [installEvt, setInstallEvt] = useState<{ prompt: () => Promise<void> } | null>(() =>
    typeof window === "undefined" ? null : ((window as unknown as { __sidifyInstall?: { prompt: () => Promise<void> } | null }).__sidifyInstall ?? null)
  );

  useEffect(() => {
    const w = window as unknown as { __sidifyInstall?: { prompt: () => Promise<void> } | null };
    const onReady = () => setInstallEvt(w.__sidifyInstall ?? null);
    window.addEventListener("sidify-install-ready", onReady);
    window.addEventListener("appinstalled", onReady);
    return () => {
      window.removeEventListener("sidify-install-ready", onReady);
      window.removeEventListener("appinstalled", onReady);
    };
  }, []);

  return (
    <>
      <Anchor id="about" />
      <Group header="App">
        <GroupRow
          icon={<Download size={18} />}
          title="Install Sidify"
          subtitle="Add it to your home screen or desktop"
          onClick={async () => {
            if (installEvt) {
              await installEvt.prompt();
              setInstallEvt(null);
            } else if (window.matchMedia("(display-mode: standalone)").matches) {
              toast({ title: "Already installed", desc: "You're using the installed app", kind: "info" });
            } else {
              toast({ title: "Install from the browser menu", desc: "⋮ → “Install app” / “Add to Home Screen”", kind: "info" });
            }
          }}
        />
        <GroupRow
          icon={<Smartphone size={18} />}
          title="Android app"
          subtitle={`${ANDROID_APP.tag} · ${APP_SIZE_LABEL} · background playback, equalizer, synced lyrics`}
          href="/app"
          chevron
        />
        <GroupRow
          icon={<RefreshCw size={18} className={checking ? "animate-spin" : ""} />}
          title={checking ? "Checking…" : "Check for updates"}
          subtitle={`Sidify ${APP_VERSION}`}
          onClick={async () => {
            setChecking(true);
            try {
              const result = await checkForUpdate();
              if (result === "updated") {
                toast({ title: "Update found", desc: "Reloading onto the new version…", kind: "ok" });
                return;
              }
              toast({
                title: result === "current" ? "You're up to date" : "Update check unavailable",
                desc: result === "current" ? `Sidify ${APP_VERSION} is the latest` : "This browser isn't running the installed app",
                kind: result === "current" ? "ok" : "warn",
              });
            } finally {
              setChecking(false);
            }
          }}
        />
      </Group>
      <Group header="About">
        <GroupRow icon={<Info size={18} />} title="Terms of Service" onClick={() => setLegal("tos")} chevron />
        <GroupRow icon={<Shield size={18} />} title="Privacy Policy" onClick={() => setLegal("privacy")} chevron />
        <GroupRow icon={<Mail size={18} />} title="Contact" subtitle={CONTACT_EMAIL} href={`mailto:${CONTACT_EMAIL}`} />
        <GroupRow title="Report a problem" href={`mailto:${CONTACT_EMAIL}?subject=Sidify%20bug%20report`} chevron />
      </Group>

      <Sheet open={legal !== null} onClose={() => setLegal(null)} title={legal === "tos" ? "Terms of Service" : "Privacy Policy"}>
        <div className="space-y-3 text-[14px] leading-relaxed text-fg-2">
          {legal === "tos" ? (
            <>
              <p>Sidify provides a clean music discovery and listening experience powered by YouTube. By using the app you agree to stream music responsibly and respect the rights of artists and labels.</p>
              <p>Downloads are cached for personal offline listening inside your own browser storage only.</p>
              <p>Listen Together rooms are temporary: they hold only what&apos;s needed to keep everyone in sync and close by themselves.</p>
            </>
          ) : (
            <>
              <p>Sidify stores your library — likes, playlists, follows and history — to power your personal pages. Clearing history permanently deletes it.</p>
              <p>Replay statistics, settings and downloads stay on your own device. Blocked artists and filters are honoured across the entire app.</p>
              <p>We never sell your listening data.</p>
            </>
          )}
        </div>
      </Sheet>
      <p className="-mt-3 mb-4 px-4 text-[12px] text-fg-3">
        See <Link href="/library/replay" className="underline">Replay</Link> for your listening stats.
      </p>
    </>
  );
}
