"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { usePlayer } from "@/store/player";
import { useWatchlist } from "@/store/watchlist";
import { initEngine, restoreSession, togglePlay, next, prev, applySettings } from "@/lib/audioEngine";
import { useLiked, useDownloads, useBlocked } from "@/lib/library";
import { resumeRoom, useRoom } from "@/lib/rooms/client";
import { registerServiceWorker, armNextAutoReload } from "@/lib/pwa";
import NameGate from "./NameGate";
import NowPlaying from "./player/NowPlaying";
import BackGuard from "./BackGuard";
import TrackMenu from "./TrackMenu";
import Toasts from "./Toasts";
import { GlobalModals } from "./Overlays";

/**
 * Persisted stores load from localStorage here, right after hydration, so the
 * server render and the first client render agree. Runs before every other
 * effect in the tree (it is the first child).
 */
function StoreHydration() {
  useEffect(() => {
    void useSettings.persist.rehydrate();
    void usePlayer.persist.rehydrate();
    void useRoom.persist.rehydrate();
    void useWatchlist.persist.rehydrate();
  }, []);
  return null;
}

function ThemeApplier() {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const mode =
        theme === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
      root.dataset.theme = mode;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", mode === "light" ? "#ffffff" : "#000000");
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return null;
}

/** Global image fallback chain + PWA wiring. */
function PlatformBootstrap() {
  useEffect(() => {
    // Thumbnail fallback: maxres -> sd -> hq -> mq -> default -> app icon
    const onErr = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (!(img instanceof HTMLImageElement) || img.dataset.fbkDone) return;
      const m = img.src.match(/i\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\/([A-Za-z0-9]+)\.jpg/);
      if (m) {
        const chain = ["maxresdefault", "sddefault", "hqdefault", "mqdefault", "default"];
        const cur = chain.indexOf(m[2]);
        const nextUrl =
          cur >= 0 && cur < chain.length - 1
            ? `https://i.ytimg.com/vi/${m[1]}/${chain[cur + 1]}.jpg`
            : cur === -1
              ? `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`
              : null;
        if (nextUrl) {
          img.src = nextUrl;
          return;
        }
      }
      img.dataset.fbkDone = "1";
      img.src = "/icon.png";
      img.style.objectFit = "cover";
    };
    document.addEventListener("error", onErr, true);

    const unregisterPwa = registerServiceWorker();
    const disarmAutoReload = armNextAutoReload();

    const bip = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __sidifyInstall?: unknown }).__sidifyInstall = e;
      window.dispatchEvent(new Event("sidify-install-ready"));
    };
    window.addEventListener("beforeinstallprompt", bip as EventListener);
    const onInstalled = () => {
      (window as unknown as { __sidifyInstall?: unknown }).__sidifyInstall = null;
      useUi.getState().pushToast({ title: "Sidify installed", desc: "Find it on your home screen", kind: "ok" });
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      document.removeEventListener("error", onErr, true);
      unregisterPwa();
      disarmAutoReload();
      window.removeEventListener("beforeinstallprompt", bip as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}

function EngineBootstrap() {
  useEffect(() => {
    initEngine();
    restoreSession();
    applySettings();
    resumeRoom();

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      } else if (e.shiftKey && e.code === "ArrowRight") {
        e.preventDefault();
        void next(true);
      } else if (e.shiftKey && e.code === "ArrowLeft") {
        e.preventDefault();
        void prev();
      } else if (e.key === "l" || e.key === "L") {
        if (window.innerWidth >= 980 && !usePlayer.getState().fullPlayerOpen) useUi.getState().toggleSidePanel("lyrics");
        else usePlayer.getState().set({ fullPlayerOpen: true, npView: usePlayer.getState().npView === "lyrics" ? "art" : "lyrics" });
      } else if (e.key === "q" || e.key === "Q") {
        if (window.innerWidth >= 980 && !usePlayer.getState().fullPlayerOpen) useUi.getState().toggleSidePanel("queue");
        else usePlayer.getState().set({ fullPlayerOpen: true, npView: usePlayer.getState().npView === "queue" ? "art" : "queue" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

/** Keeps global id-maps (liked / downloaded / blocked) warm everywhere. */
function DataSync() {
  useLiked();
  useDownloads();
  useBlocked();
  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <StoreHydration />
      <ThemeApplier />
      <EngineBootstrap />
      <PlatformBootstrap />
      <DataSync />
      {children}
      <NameGate />
      <NowPlaying />
      <BackGuard />
      <TrackMenu />
      <GlobalModals />
      <Toasts />
    </QueryClientProvider>
  );
}
