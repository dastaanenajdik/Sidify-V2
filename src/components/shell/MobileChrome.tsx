"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { usePlayer, currentTrack } from "@/store/player";
import { next, togglePlay } from "@/lib/audioEngine";
import { useRoomSummary } from "@/lib/rooms/client";
import { cx } from "@/lib/format";
import { ExploreGlyph, ForwardGlyph, HomeGlyph, LibraryGlyph, PauseGlyph, PeopleGlyph, PlayGlyph, SearchGlyph } from "../icons";
import { Artwork } from "../ui";

const TABS = [
  { href: "/", label: "Home", icon: HomeGlyph, match: (p: string) => p === "/" },
  { href: "/explore", label: "Explore", icon: ExploreGlyph, match: (p: string) => p.startsWith("/explore") },
  { href: "/search", label: "Search", icon: SearchGlyph, match: (p: string) => p.startsWith("/search") },
  {
    href: "/library",
    label: "Library",
    icon: LibraryGlyph,
    match: (p: string) => p.startsWith("/library") || p.startsWith("/playlist") || p.startsWith("/downloads"),
  },
  { href: "/rooms", label: "Together", icon: PeopleGlyph, match: (p: string) => p.startsWith("/rooms") },
];

/** Phones: the floating glass tab bar. Selection is carried by a soft white pill. */
export function MobileNav() {
  const pathname = usePathname() || "/";
  const room = useRoomSummary();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[calc(10px+env(safe-area-inset-bottom,0px))] desk:hidden"
    >
      <div className="bar-glass flex h-[62px] w-full max-w-[440px] items-center justify-between rounded-full px-1.5">
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
                "relative flex h-[50px] flex-1 flex-col items-center justify-center gap-[3px] rounded-full transition-colors duration-150",
                on ? "text-fg" : "text-fg/60 hover:text-fg/85"
              )}
            >
              {on && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-full bg-fill-3"
                  transition={{ type: "spring", damping: 30, stiffness: 420 }}
                />
              )}
              <span className="relative">
                <Icon size={22} />
                {t.href === "/rooms" && room.inRoom && (
                  <span className="absolute -top-1 -right-2 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                    {room.count || ""}
                  </span>
                )}
              </span>
              <span className="relative text-[10px] leading-none font-semibold">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Phones: the floating pill mini player, just above the tab bar. */
export function MiniPlayer() {
  const track = usePlayer((s) => currentTrack(s));
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs || currentTrack(s)?.durationMs || 0);
  const open = usePlayer((s) => s.fullPlayerOpen);
  const room = useRoomSummary();
  if (!track || open) return null;
  const pct = durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0;

  return (
    <div className="fixed inset-x-0 z-40 flex justify-center px-3 bottom-[calc(80px+env(safe-area-inset-bottom,0px))] desk:hidden">
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bar-glass relative flex h-[58px] w-full max-w-[440px] items-center gap-3 overflow-hidden rounded-[18px] pr-1.5 pl-2"
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => usePlayer.getState().set({ fullPlayerOpen: true })}
          aria-label="Open Now Playing"
        >
          <Artwork src={track.artwork} size={42} rounded="rounded-[9px]" className="h-[42px] w-[42px] shadow-md" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] leading-tight font-semibold">{track.title}</span>
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
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:scale-90"
        >
          {isPlaying ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => void next(true)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:scale-90"
        >
          <ForwardGlyph size={22} />
        </button>
        <div className="absolute right-4 bottom-0 left-4 h-[2px] overflow-hidden rounded-full bg-fill-2">
          <div className={cx("h-full bg-fg/70", isLoading && "animate-pulse")} style={{ width: `${pct}%` }} />
        </div>
      </motion.div>
    </div>
  );
}
