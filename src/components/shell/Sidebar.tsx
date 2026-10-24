"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Clapperboard, Clock3, Download, Heart, ListMusic, Plus, Settings, Smartphone, Sparkles, Tv } from "lucide-react";
import { usePlaylists } from "@/lib/library";
import { useRoomSummary } from "@/lib/rooms/client";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";
import { LogoFull } from "../Logo";
import { ExploreGlyph, HomeGlyph, LibraryGlyph, PeopleGlyph, SearchGlyph } from "../icons";
import { Artwork } from "../ui";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function Item({
  href,
  icon,
  label,
  trailing,
  exact,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname() || "/";
  const on = exact ? pathname === href : isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "flex h-8 items-center gap-2.5 rounded-[7px] px-2.5 text-[14px] transition-colors duration-100",
        on ? "bg-fill-2 font-semibold text-fg" : "text-fg/90 hover:bg-fill"
      )}
    >
      <span className={cx("grid h-[18px] w-[18px] shrink-0 place-items-center", on ? "text-playing" : "text-fg-2")}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </Link>
  );
}

function SidebarSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const typing = useRef(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (pathname !== "/search") setQ("");
  }
  // Live results while typing, without a request per keystroke.
  useEffect(() => {
    if (!typing.current) return;
    const t = setTimeout(() => {
      typing.current = false;
      router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });
    }, 280);
    return () => clearTimeout(t);
  }, [q, router]);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        typing.current = false;
        router.push(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
      }}
      className="relative"
    >
      <SearchGlyph size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-2" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          typing.current = true;
        }}
        onFocus={() => {
          if (pathname !== "/search") router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
        }}
        placeholder="Search"
        aria-label="Search music"
        className="field h-9 w-full rounded-[7px] pl-8 text-[13.5px]"
      />
    </form>
  );
}

export default function Sidebar() {
  const { data } = usePlaylists();
  const pinned = useSettings((s) => s.pinnedPlaylists);
  const room = useRoomSummary();
  const playlists = [...(data?.playlists ?? [])].sort(
    (a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id))
  );

  return (
    <aside className="chrome-glass relative z-20 hidden h-full w-[220px] shrink-0 flex-col shadow-[inset_-0.5px_0_0_var(--hairline)] desk:flex">
      <div className="flex h-[60px] shrink-0 items-center px-4">
        <Link href="/" aria-label="Sidify home" className="rounded-md">
          <LogoFull size={28} />
        </Link>
      </div>
      <div className="px-3 pb-3">
        <SidebarSearch />
      </div>

      <nav className="no-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" aria-label="Main">
        <Item href="/" icon={<HomeGlyph size={17} />} label="Home" exact />
        <Item href="/explore" icon={<ExploreGlyph size={16} />} label="Explore" />
        <Item href="/movies" icon={<Clapperboard size={17} />} label="Movies" />
        <Item href="/series" icon={<Tv size={17} />} label="Series" />
        <Item href="/exclusive" icon={<Sparkles size={16} />} label="Exclusive" />
        <Item href="/library" icon={<LibraryGlyph size={17} />} label="Library" />
        <Item href="/search" icon={<SearchGlyph size={16} />} label="Search" />

        <div className="h-3" />
        <Item
          href={room.code ? `/rooms/${room.code}` : "/rooms"}
          icon={<PeopleGlyph size={18} />}
          label="Listen Together"
          trailing={
            room.inRoom ? (
              <span className="flex items-center gap-1 rounded-full bg-brand px-1.5 py-[1px] text-[10px] font-bold text-white">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-white" />
                {room.count || ""}
              </span>
            ) : null
          }
        />
        <Item href="/library/history" icon={<Clock3 size={17} />} label="History" />
        <Item href="/downloads" icon={<Download size={17} />} label="Downloads" />

        <div className="flex items-center justify-between px-2.5 pt-5 pb-1.5">
          <span className="t-caption tracking-wide text-fg-2 uppercase">Playlists</span>
          <button
            type="button"
            aria-label="New playlist"
            title="New playlist"
            onClick={() => useUi.getState().setCreatePlaylistOpen(true)}
            className="grid h-6 w-6 place-items-center rounded-full text-fg-2 hover:bg-fill hover:text-fg"
          >
            <Plus size={15} />
          </button>
        </div>
        <Item href="/library/liked" icon={<Heart size={16} fill="currentColor" className="text-playing" />} label="Liked Songs" />
        {playlists.slice(0, 40).map((p) => (
          <Item
            key={p.id}
            href={`/playlist/${p.id}`}
            icon={
              p.tracks[0]?.artwork ? (
                <Artwork src={p.tracks[0].artwork} size={18} rounded="rounded-[4px]" className="h-[18px] w-[18px]" />
              ) : (
                <ListMusic size={16} />
              )
            }
            label={p.name}
          />
        ))}
      </nav>

      <div className="hairline-t space-y-0.5 px-3 py-3">
        <Item href="/settings" icon={<Settings size={17} />} label="Settings" />
        <Item href="/app" icon={<Smartphone size={17} />} label="Get the Android app" />
      </div>
    </aside>
  );
}
