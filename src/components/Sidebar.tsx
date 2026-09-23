"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Compass, Download, Home, Library, Plus, Search, Settings, Smartphone } from "lucide-react";
import SidifyLogo from "./SidifyLogo";
import { usePlaylists } from "@/lib/library";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import { cx } from "@/lib/format";
import { ANDROID_APP } from "@/lib/appRelease";

type NavItem = {
  href: string;
  label: string;
  /** Shorter label for the tight mobile tab bar. */
  short?: string;
  icon: typeof Home;
  badge?: string;
  highlight?: boolean;
};

const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: Library },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/app", label: "Get the app", short: "App", icon: Smartphone, badge: "NEW", highlight: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data } = usePlaylists();
  const profileName = useSettings((s) => s.profileName);

  return (
    <aside className="sticky top-0 z-30 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--bg)] md:flex">
      <Link href="/" className="flex items-center gap-2.5 px-5 pt-6 pb-7">
        <SidifyLogo size={38} />
        <span className="font-display text-[22px] font-extrabold tracking-tight">
          Sid<span className="accent-text">ify</span>
        </span>
      </Link>

      <nav className="space-y-1 px-3">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                "flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold transition-all",
                active ? "bg-[var(--panel-strong)] text-[var(--text)]" : "text-muted hover:text-[var(--text)]",
                n.highlight && !active && "text-[var(--text)]"
              )}
            >
              <n.icon
                size={20}
                className={active || n.highlight ? "accent-text" : ""}
                style={active || n.highlight ? { filter: "drop-shadow(0 0 8px var(--glow))" } : undefined}
              />
              {n.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full accent-bg" style={{ boxShadow: "0 0 8px var(--accent)" }} />}
              {n.badge && (
                <span
                  className={cx(
                    "rounded-full accent-bg px-1.5 py-[1px] text-[9px] font-extrabold tracking-[0.08em] text-black",
                    !active && "ml-auto"
                  )}
                >
                  {n.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Android app card — always one tap away */}
      <div className="mt-4 px-3">
        <Link
          href="/app"
          className="hover-panel group block overflow-hidden rounded-2xl border p-3.5"
          style={{
            borderColor: "color-mix(in srgb, var(--accent) 38%, transparent)",
            background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 17%, transparent), transparent 72%)",
          }}
        >
          <span className="flex items-center gap-2 text-[12.5px] font-extrabold">
            <Smartphone size={14} className="accent-text" />
            Android app {ANDROID_APP.tag}
          </span>
          <span className="text-muted mt-1.5 block text-[11.5px] leading-4">
            Background playback, equalizer, 8D audio and offline downloads. Free APK.
          </span>
          <span className="accent-text mt-2 flex items-center gap-1 text-[11.5px] font-bold">
            Download the app
            <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </div>

      <div className="mt-8 flex min-h-0 flex-1 flex-col px-3">
        <div className="mb-2 flex items-center justify-between px-3.5">
          <span className="text-muted-2 text-[11px] font-bold tracking-[0.18em] uppercase">Playlists</span>
          <Link href="/library?create=1" aria-label="Create playlist" className="text-muted hover:accent-text">
            <Plus size={16} />
          </Link>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-4">
          {(data?.playlists ?? []).map((p) => (
            <Link
              key={p.id}
              href={`/playlist/${p.id}`}
              className={cx(
                "block truncate rounded-lg px-3.5 py-2 text-[13px]",
                pathname === `/playlist/${p.id}` ? "bg-[var(--panel)] text-[var(--text)]" : "text-muted hover:text-[var(--text)]"
              )}
            >
              {p.name}
              <span className="text-muted-2 float-right text-[11px]">{p.tracks.length}</span>
            </Link>
          ))}
          {(data?.playlists ?? []).length === 0 && (
            <p className="text-muted-2 px-3.5 text-[12px] leading-5">
              Create playlists to build your own universe of sound.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border-soft)] p-3">
        <Link
          href="/settings"
          className={cx(
            "flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold",
            pathname.startsWith("/settings") ? "bg-[var(--panel-strong)]" : "text-muted hover:text-[var(--text)]"
          )}
        >
          <Settings size={20} className={pathname.startsWith("/settings") ? "accent-text" : ""} />
          Settings
        </Link>
        <Link href="/settings" className="hover-panel mt-2 flex items-center gap-3 rounded-xl px-3.5 py-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full accent-bg text-[13px] font-bold text-black">
            {(profileName || "S").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{profileName || "Guest"}</span>
            <span className="text-muted-2 flex items-center gap-1 text-[11px]">
              <Compass size={10} /> Free Universe Plan
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items: NavItem[] = [...NAV, { href: "/settings", label: "Settings", icon: Settings }];
  return (
    <nav className="glass-strong fixed right-0 bottom-0 left-0 z-40 grid h-[64px] grid-cols-6 border-t border-[var(--border)] md:hidden">
      {items.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} className="relative flex flex-col items-center justify-center gap-1">
            <n.icon
              size={20}
              className={active ? "accent-text" : n.highlight ? "accent-text" : "text-muted"}
              style={active || n.highlight ? { filter: "drop-shadow(0 0 8px var(--glow))" } : undefined}
            />
            <span
              className={cx(
                "max-w-full truncate px-0.5 text-[9.5px] font-medium",
                active ? "text-[var(--text)]" : n.highlight ? "accent-text font-bold" : "text-muted-2"
              )}
            >
              {n.short ?? n.label}
            </span>
            {n.badge && (
              <span className="absolute top-1.5 right-[22%] h-1.5 w-1.5 animate-pulse rounded-full accent-bg" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
