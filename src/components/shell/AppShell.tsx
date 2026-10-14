"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePlayer, currentTrack } from "@/store/player";
import { useSettings } from "@/store/settings";
import MeshBackdrop from "../MeshBackdrop";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import SidePanel from "./SidePanel";
import { MiniPlayer, MobileNav } from "./MobileChrome";

/**
 * The window: sidebar | (top bar over page + side panel). On phones the
 * sidebar and top bar give way to a floating tab bar and mini player.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);

  // A new page starts at the top, like a real navigation.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="relative flex h-dvh overflow-hidden bg-bg">
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <PageAmbience />
            <main ref={mainRef} id="main" className="absolute inset-0 overflow-x-hidden overflow-y-auto">
              {children}
              <div className="h-[calc(170px+env(safe-area-inset-bottom,0px))] desk:h-12" />
            </main>
          </div>
          <SidePanel />
        </div>
      </div>
      <MiniPlayer />
      <MobileNav />
    </div>
  );
}

/**
 * The page backdrop: the current artwork's mesh, dimmed almost to black, so
 * every page carries a trace of what's playing.
 */
function PageAmbience() {
  const track = usePlayer((s) => currentTrack(s));
  const covered = usePlayer((s) => s.fullPlayerOpen);
  const dynamic = useSettings((s) => s.dynamicColor);
  // Nothing to tint with, tinting is off, or Now Playing covers the page anyway.
  if (!track || !dynamic || covered) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-0 top-0 h-[520px] opacity-80">
        <MeshBackdrop artwork={track.artwork} blur={90} scrim={false} driftKey={track.id} />
      </div>
      <div className="page-shade absolute inset-x-0 top-0 h-[520px]" />
    </div>
  );
}
