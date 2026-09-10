"use client";

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { initEngine, restoreSession, togglePlay, next, prev, applySettings } from "@/lib/audioEngine";
import { useLiked, useDownloads, useBlocked } from "@/lib/library";
import MiniPlayer from "./MiniPlayer";
import FullPlayer from "./FullPlayer";
import TrackMenu from "./TrackMenu";
import Toasts from "./Toasts";
import { GlobalModals } from "./Modals";
import { MobileNav } from "./Sidebar";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ThemeApplier() {
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--glow", hexToRgba(accent, 0.35));
    const apply = () => {
      const mode =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark"
          : theme;
      root.dataset.theme = mode;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", mode === "light" ? "#f3f4f9" : "#06060a");
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme, accent]);

  return null;
}

/** Global image fallback chain + PWA wiring — zero visual changes. */
function PlatformBootstrap() {
  useEffect(() => {
    // Thumbnail fallback: maxres -> hq -> mq -> default -> local placeholder
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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

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

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      } else if (e.shiftKey && e.code === "ArrowRight") {
        e.preventDefault();
        void next(true);
      } else if (e.shiftKey && e.code === "ArrowLeft") {
        e.preventDefault();
        void prev();
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
      <ThemeApplier />
      <EngineBootstrap />
      <PlatformBootstrap />
      <DataSync />
      {children}
      <MiniPlayer />
      <FullPlayer />
      <TrackMenu />
      <GlobalModals />
      <Toasts />
      <MobileNav />
    </QueryClientProvider>
  );
}
