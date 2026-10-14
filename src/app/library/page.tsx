"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock3, Download, Heart, LayoutGrid, List, ListMusic, Pin, Plus } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useFollowed, usePlaylists } from "@/lib/library";
import { readPlayLog } from "@/lib/playLog";
import { useMounted } from "@/lib/useMounted";
import { computeReplay } from "@/lib/replay";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { cx, uniqueTracks } from "@/lib/format";
import type { PlaylistRow } from "@/lib/types";
import { ArtistCard, SongCard, SquareCard } from "@/components/cards";
import { Artwork, IconButton, PageTitle, SectionHeader, Shelf } from "@/components/ui";
import { LyricsGlyph, PeopleGlyph } from "@/components/icons";
import ReplayCard from "@/components/ReplayCard";
import { useRoomSummary } from "@/lib/rooms/client";

function LibraryInner() {
  const params = useSearchParams();
  const router = useRouter();

  // Old deep links (?tab=liked, ?tab=lyrics, ?create=1) still land somewhere sensible.
  useEffect(() => {
    const tab = params.get("tab");
    if (tab === "liked") router.replace("/library/liked");
    else if (tab === "history") router.replace("/library/history");
    else if (tab === "lyrics") router.replace("/library/lyrics");
    if (params.get("create") === "1") {
      useUi.getState().setCreatePlaylistOpen(true);
      router.replace("/library");
    }
  }, [params, router]);

  const layout = useSettings((s) => s.libraryLayout);
  const setSettings = useSettings((s) => s.set);
  const room = useRoomSummary();
  const mounted = useMounted();
  const recent = useQuery({ queryKey: ["recent"], queryFn: api.recent, staleTime: 30_000 });
  const recentTracks = mounted ? uniqueTracks(recent.data?.tracks ?? []).slice(0, 20) : [];
  const { data: followedData } = useFollowed();
  const followed = mounted ? followedData : undefined;

  const links = [
    { href: "/library/liked", label: "Liked Songs", icon: <Heart size={22} /> },
    { href: "/library/history", label: "History", icon: <Clock3 size={22} /> },
    { href: "/downloads", label: "Downloads", icon: <Download size={22} /> },
    { href: "/library/lyrics", label: "Lyrics finder", icon: <LyricsGlyph size={22} /> },
    { href: room.code ? `/rooms/${room.code}` : "/rooms", label: room.inRoom ? `Listen Together · ${room.count}` : "Listen Together", icon: <PeopleGlyph size={22} /> },
  ];

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          <>
            <IconButton
              label={layout === "grid" ? "Show as list" : "Show as grid"}
              tone="fill"
              size={34}
              onClick={() => setSettings({ libraryLayout: layout === "grid" ? "list" : "grid" })}
            >
              {layout === "grid" ? <List size={17} /> : <LayoutGrid size={16} />}
            </IconButton>
            <IconButton label="New playlist" tone="fill" size={34} onClick={() => useUi.getState().setCreatePlaylistOpen(true)}>
              <Plus size={18} />
            </IconButton>
          </>
        }
      >
        Library
      </PageTitle>

      <ReplayRow />

      <div className="mb-7 px-4 desk:px-8">
        <div className="max-w-[720px]">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="group flex min-h-[54px] items-center gap-4">
              <span className="grid w-6 shrink-0 place-items-center text-playing">{l.icon}</span>
              <span className="flex min-h-[54px] min-w-0 flex-1 items-center gap-2 shadow-[inset_0_-0.5px_0_var(--hairline)] group-last:shadow-none">
                <span className="min-w-0 flex-1 truncate text-[17px]">{l.label}</span>
                <ChevronRight size={20} className="shrink-0 text-fg-3" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <Playlists layout={layout} />

      {(followed?.artists?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="Artists" />
          <Shelf>
            {followed!.artists.map((a) => (
              <ArtistCard key={a.artistId} artist={a.artist} />
            ))}
          </Shelf>
        </section>
      )}

      {recentTracks.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Recently played" href="/library/history" />
          <Shelf>
            {recentTracks.map((t, i) => (
              <SongCard key={t.id} tracks={recentTracks} index={i} label="Recently played" />
            ))}
          </Shelf>
        </section>
      )}
    </div>
  );
}

function ReplayRow() {
  const name = useSettings((s) => s.profileName);
  const mounted = useMounted();
  const log = useMemo(() => (mounted ? readPlayLog() : []), [mounted]);
  const stats = useMemo(() => computeReplay(log, "year"), [log]);
  const since = stats.firstAt ? new Date(stats.firstAt).toLocaleDateString(undefined, { month: "2-digit", year: "2-digit" }) : null;
  const year = new Date().getFullYear();
  if (!log.length) {
    return (
      <div className="mb-6 px-4 desk:px-8">
        <Link href="/library/replay" className="flex items-center gap-4 rounded-[16px] bg-raised p-4 ring-1 ring-edge hover:bg-raised-2">
          <span className="grid h-12 w-12 place-items-center rounded-[12px] bg-brand text-[18px] font-extrabold text-white">{String(year).slice(2)}</span>
          <span className="min-w-0">
            <span className="block text-[16px] font-semibold">Replay {year}</span>
            <span className="block text-[13px] text-fg-2">Your top songs and artists show up here as you listen.</span>
          </span>
        </Link>
      </div>
    );
  }
  const topSong = stats.songs[0];
  const topArtist = stats.artists[0];
  return (
    <div className="mb-6">
      <Shelf gap={12}>
        <ReplayCard
          label={`Replay ${year}`}
          value={`${stats.minutes.toLocaleString()} min`}
          detail={`${stats.plays} plays · ${stats.activeDays} day${stats.activeDays === 1 ? "" : "s"}`}
          artwork={topSong?.entry.art}
          holder={name}
          since={since}
          href="/library/replay"
        />
        {topArtist && (
          <ReplayCard label="Top artist" value={topArtist.name} detail={`${topArtist.plays} plays`} artwork={topArtist.artwork} holder={name} since={since} href="/library/replay#artists" />
        )}
        {topSong && (
          <ReplayCard
            label="Top song"
            value={topSong.entry.t}
            detail={`${topSong.entry.a} · ${topSong.plays} plays`}
            artwork={topSong.entry.art}
            holder={name}
            since={since}
            href="/library/replay#songs"
          />
        )}
      </Shelf>
    </div>
  );
}

function Playlists({ layout }: { layout: "grid" | "list" }) {
  const { data: loaded } = usePlaylists();
  // This page hydrates inside a Suspense boundary, possibly after the sidebar
  // has already fetched playlists — wait for mount so the HTML still matches.
  const mounted = useMounted();
  const data = mounted ? loaded : undefined;
  const pinned = useSettings((s) => s.pinnedPlaylists);
  const setSettings = useSettings((s) => s.set);
  const playlists = [...(data?.playlists ?? [])].sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));
  const togglePin = (p: PlaylistRow) =>
    setSettings({ pinnedPlaylists: pinned.includes(p.id) ? pinned.filter((x) => x !== p.id) : [p.id, ...pinned] });

  return (
    <section className="mb-9">
      <SectionHeader title="Playlists" />
      {layout === "grid" ? (
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <button
            type="button"
            onClick={() => useUi.getState().setCreatePlaylistOpen(true)}
            className="group/card text-left"
          >
            <span className="grid aspect-square w-full place-items-center rounded-[12px] border border-dashed border-fill-3 text-fg-2 transition-colors group-hover/card:bg-fill">
              <Plus size={34} strokeWidth={1.6} />
            </span>
            <span className="mt-2 block text-[14px] font-medium">New playlist</span>
          </button>
          {playlists.map((p) => (
            <div key={p.id} className="relative">
              <SquareCard
                href={`/playlist/${p.id}`}
                arts={p.tracks.slice(0, 4).map((t) => t.artwork)}
                title={p.name}
                subtitle={`${p.tracks.length} song${p.tracks.length === 1 ? "" : "s"}`}
                className="!w-auto"
                badge={pinned.includes(p.id) ? <PinBadge /> : undefined}
              />
              <button
                type="button"
                aria-label={pinned.includes(p.id) ? "Unpin" : "Pin to the top"}
                title={pinned.includes(p.id) ? "Unpin" : "Pin to the top"}
                onClick={() => togglePin(p)}
                className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-md transition-opacity hover:opacity-100 focus:opacity-100 [div:hover>&]:opacity-100"
              >
                <Pin size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="max-w-[720px] px-2 desk:px-6">
          <button
            type="button"
            onClick={() => useUi.getState().setCreatePlaylistOpen(true)}
            className="flex h-[68px] w-full items-center gap-3 rounded-[10px] px-2 text-left hover:bg-fill"
          >
            <span className="grid h-[52px] w-[52px] place-items-center rounded-[8px] border border-dashed border-fill-3 text-fg-2">
              <Plus size={22} />
            </span>
            <span className="text-[16px]">New playlist</span>
          </button>
          {playlists.map((p) => (
            <div key={p.id} className="group flex h-[68px] items-center gap-3 rounded-[10px] px-2 hover:bg-fill">
              <Link href={`/playlist/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                {p.tracks[0] ? (
                  <Artwork src={p.tracks[0].artwork} size={52} rounded="rounded-[8px]" className="h-[52px] w-[52px]" />
                ) : (
                  <span className="grid h-[52px] w-[52px] place-items-center rounded-[8px] bg-fill-2 text-fg-2">
                    <ListMusic size={22} />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-[16px]">
                    {pinned.includes(p.id) && <Pin size={12} className="shrink-0 text-playing" />}
                    {p.name}
                  </span>
                  <span className="block text-[13px] text-fg-2">
                    Playlist · {p.tracks.length} song{p.tracks.length === 1 ? "" : "s"}
                  </span>
                </span>
              </Link>
              <IconButton label={pinned.includes(p.id) ? "Unpin" : "Pin"} size={32} className={cx("text-fg-2", !pinned.includes(p.id) && "opacity-0 group-hover:opacity-100")} onClick={() => togglePin(p)}>
                <Pin size={15} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PinBadge() {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md">
      <Pin size={12} />
    </span>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryInner />
    </Suspense>
  );
}

