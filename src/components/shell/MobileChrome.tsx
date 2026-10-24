"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Clapperboard } from "lucide-react";
import { usePlayer, currentTrack } from "@/store/player";
import { next, togglePlay } from "@/lib/audioEngine";
import { useRoomSummary } from "@/lib/rooms/client";
import { cx } from "@/lib/format";
import { ExploreGlyph, ForwardGlyph, HomeGlyph, LibraryGlyph, PauseGlyph, PeopleGlyph, PlayGlyph, SearchGlyph } from "../icons";
import { Artwork } from "../ui";

const TABS = [
  { href: "/", label: "Home", icon: HomeGlyph, match: (p: string) => p === "/" },
  { href: "/explore", label: "Explore", icon: ExploreGlyph, match: (p: string) => p.startsWith("/explore") },
  {
    href: "/movies",
    label: "Movies",
    icon: Clapperboard,
    match: (p: string) => p.startsWith("/movies") || p.startsWith("/series"),
  },
  { href: "/search", label: "Search", icon: SearchGlyph, match: (p: string) => p.startsWith("/search") },
  {
    href: "/library",
    label: "Library",
    icon: LibraryGlyph,
    match: (p: string) => p.startsWith("/library") || p.startsWith("/playlist") || p.startsWith("/downloads"),
  },
  { href: "/rooms", label: "Together", icon: PeopleGlyph, match: (p: string) => p.startsWith("/rooms") },
];

/** Phones: the floating glass tab bar — liquid iOS 26 lens */
export function MobileNav() {
  const pathname = usePathname() || "/";
  const room = useRoomSummary();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-2.5 sm:px-3 pb-[calc(10px+env(safe-area-inset-bottom,0px))] desk:hidden"
    >
      <div className="bar-glass flex h-[64px] w-full max-w-[460px] items-center justify-between rounded-full px-1 sm:px-1.5">
        {/* liquid lens layers */}
        <span aria-hidden className="liquid-edge" />
        <span aria-hidden className="liquid-sheen" />
        {/* hairline specular — ultra-thin top highlight like iOS */}
        <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-90" />
        <span aria-hidden className="pointer-events-none absolute inset-x-6 top-px h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        {TABS.map((t) => {
          const on = t.match(pathname);
          const href = t.href === "/rooms" && room.code ? `/rooms/${room.code}` : t.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={cx(
                "relative flex h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-full px-0.5 transition-colors duration-150",
                on ? "text-fg" : "text-fg/60 hover:text-fg/85"
              )}
            >
              {on && (
                <motion.span
                  layoutId="tab-pill"
                  className="pill-glass absolute inset-0 rounded-full"
                  transition={{ type: "spring", damping: 32, stiffness: 460 }}
                />
              )}
              <span className="relative">
                <Icon size={21} />
                {t.href === "/rooms" && room.inRoom && (
                  <span className="absolute -top-1 -right-2 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                    {room.count || ""}
                  </span>
                )}
              </span>
              <span className="relative max-w-full truncate text-[9.5px] sm:text-[10px] leading-none font-semibold">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Isolated progress leaf so playback ticks never re-render MiniPlayer artwork/buttons. */
function MiniPlayerProgress({ fallbackDurationMs }: { fallbackDurationMs: number }) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs || fallbackDurationMs || 0);
  const isLoading = usePlayer((s) => s.isLoading);
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, positionMs / durationMs)) : 0;

  return (
    <div className="pointer-events-none absolute right-4 bottom-0 left-4 h-[2px] overflow-hidden rounded-full bg-white/[0.10]">
      <div
        className={cx("h-full w-full origin-left rounded-full bg-white/85", isLoading && "animate-pulse")}
        style={{ transform: `scaleX(${ratio.toFixed(4)})` }}
      />
    </div>
  );
}

/** Phones: the floating pill mini player, just above the tab bar — liquid iOS 26 lens */
export function MiniPlayer() {
  const track = usePlayer((s) => currentTrack(s));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const open = usePlayer((s) => s.fullPlayerOpen);
  const room = useRoomSummary();
  if (!track || open) return null;

  return (
    <div className="fixed inset-x-0 z-40 flex justify-center px-2.5 sm:px-3 bottom-[calc(82px+env(safe-area-inset-bottom,0px))] desk:hidden">
      <div className="bar-glass relative flex h-[58px] w-full max-w-[460px] items-center gap-2.5 sm:gap-3 overflow-hidden rounded-[18px] pr-1.5 pl-2">
        {/* liquid lens layers inside the pill */}
        <span aria-hidden className="liquid-edge rounded-[inherit]" />
        <span aria-hidden className="liquid-sheen rounded-[inherit]" />
        {/* extra top specular for the pill */}
        <span aria-hidden className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        {/* subtle inner lens glow */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-60"
          style={{
            background:
              "radial-gradient(120% 80% at 30% 0%, rgba(255,255,255,0.10) 0%, transparent 52%), radial-gradient(90% 120% at 90% 100%, rgba(255,255,255,0.05) 0%, transparent 46%)",
          }}
        />

        <button
          type="button"
          className="relative flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3 text-left"
          onClick={() => usePlayer.getState().set({ fullPlayerOpen: true })}
          aria-label="Open Now Playing"
        >
          <Artwork src={track.artwork} size={42} rounded="rounded-[10px]" className="h-[42px] w-[42px] shadow-md ring-1 ring-white/10" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] leading-tight font-semibold tracking-[-0.1px]">{track.title}</span>
            <span className="flex items-center gap-1.5 truncate text-[12.5px] leading-tight text-fg-2">
              {room.inRoom && (
                <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-playing">
                  <PeopleGlyph size={12} /> {room.count}
                </span>
              )}
              <span className="truncate">{track.artist}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => void togglePlay()}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08] ring-1 ring-white/10 active:scale-90 hover:bg-white/[0.12] transition-colors"
        >
          {isPlaying ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => void next(true)}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full active:scale-90 hover:bg-white/[0.06] transition-colors"
        >
          <ForwardGlyph size={22} />
        </button>
        <MiniPlayerProgress fallbackDurationMs={track.durationMs || 0} />
      </div>
    </div>
  );
}
