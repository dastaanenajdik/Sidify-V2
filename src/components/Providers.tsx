"use client";

import { ReactNode, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { usePlayer } from "@/store/player";
import { useWatchlist } from "@/store/watchlist";
import { initEngine, restoreSession, togglePlay, next, prev, applySettings } from "@/lib/audioEngine";
import { useLiked, useDownloads, useBlocked } from "@/lib/library";
import { likedTracksLocal } from "@/lib/localLibrary";
import { resumeRoom, useRoom } from "@/lib/rooms/client";
import { registerServiceWorker, armNextAutoReload } from "@/lib/pwa";
import BackGuard from "./BackGuard";
import Toasts from "./Toasts";

const NameGate = dynamic(() => import("./NameGate"), { ssr: false });
const NowPlaying = dynamic(() => import("./player/NowPlaying"), { ssr: false });
const TrackMenu = dynamic(() => import("./TrackMenu"), { ssr: false });
const GlobalModals = dynamic(() => import("./Overlays").then((m) => m.GlobalModals), { ssr: false });

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
    // Seed liked hearts synchronously from localStorage so heart icons never wait on a network fetch.
    const localLiked = likedTracksLocal();
    if (localLiked.length) {
      usePlayer.getState().set({
        likedIds: Object.fromEntries(localLiked.map((t) => [t.id, true])),
      });
    }
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

/** Lazily mounts heavy overlay trees on first demand, while warming chunks at idle. */
function DeferredOverlays() {
  const fullPlayerOpen = usePlayer((s) => s.fullPlayerOpen);
  const hasMenu = useUi((s) => s.menu !== null);
  const hasModal = useUi(
    (s) =>
      Boolean(
        s.addToPlaylistTrack ||
          s.createPlaylistOpen ||
          s.sleepMenuOpen ||
          s.statsOpen ||
          s.lyricsShare
      )
  );

  const [npMounted, setNpMounted] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [modalsMounted, setModalsMounted] = useState(false);

  if (fullPlayerOpen && !npMounted) setNpMounted(true);
  if (hasMenu && !menuMounted) setMenuMounted(true);
  if (hasModal && !modalsMounted) setModalsMounted(true);

  useEffect(() => {
    const warm = () => {
      void import("./player/NowPlaying");
      void import("./TrackMenu");
    };
    const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    const cancelRic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 2500 });
      return () => cancelRic?.(id);
    }
    const timer = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {npMounted && <NowPlaying />}
      {menuMounted && <TrackMenu />}
      {modalsMounted && <GlobalModals />}
    </>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 2 * 60_000,
            gcTime: 15 * 60_000,
          },
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
      <DeferredOverlays />
      <BackGuard />
      <Toasts />
    </QueryClientProvider>
  );
}
