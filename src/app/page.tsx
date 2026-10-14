"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Settings } from "lucide-react";
import { api } from "@/lib/clientApi";
import { playContext, startRadio } from "@/lib/audioEngine";
import { useLiked } from "@/lib/library";
import { useSettings } from "@/store/settings";
import { usePlayer, currentTrack } from "@/store/player";
import { readPlayLog, entryTrack } from "@/lib/playLog";
import { greeting, shuffled, uniqueTracks } from "@/lib/format";
import type { Track } from "@/lib/types";
import { AlbumCard, ArtistCard, HeroCard, QuickPicks, SongCard } from "@/components/cards";
import { Button, EmptyState, SectionHeader, Shelf, Skeleton } from "@/components/ui";
import { LogoMark } from "@/components/Logo";
import { PeopleGlyph } from "@/components/icons";
import { useRoomSummary } from "@/lib/rooms/client";
import { useMounted } from "@/lib/useMounted";

export default function HomePage() {
  const region = useSettings((s) => s.region);
  const name = useSettings((s) => s.profileName);
  const ef = useSettings((s) => s.explicitFilter);
  const home = useQuery({ queryKey: ["home", region], queryFn: () => api.home(region), staleTime: 5 * 60_000 });
  const recentQ = useQuery({ queryKey: ["recent"], queryFn: api.recent, staleTime: 30_000 });
  const { data: likedData } = useLiked();
  const playing = usePlayer((s) => currentTrack(s));

  const clean = (list: Track[] | undefined) => (ef ? (list ?? []).filter((t) => !t.explicit) : (list ?? []));
  const recent = uniqueTracks(clean(recentQ.data?.tracks ?? home.data?.recentlyPlayed)).slice(0, 20);
  const liked = clean(likedData?.tracks);
  const seed = playing ?? recent[0] ?? null;

  // What YouTube Music would play after your latest song — the heart of the recommendations.
  const radio = useQuery({
    queryKey: ["radio", seed?.videoId],
    queryFn: () => api.radio(seed!.videoId!, 24),
    enabled: !!seed?.videoId,
    staleTime: 15 * 60_000,
  });
  const becauseTracks = clean(radio.data?.tracks).filter((t) => t.id !== seed?.id);

  const topArtist = useMemo(() => {
    const counts = new Map<string, { n: number; track: Track }>();
    for (const e of readPlayLog().slice(-400)) {
      const key = e.a;
      const cur = counts.get(key);
      counts.set(key, { n: (cur?.n ?? 0) + 1, track: entryTrack(e) });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.track ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent.length]);

  const trending = clean(home.data?.trending);
  const recommended = clean(home.data?.recommended);
  const quick = (becauseTracks.length >= 8 ? becauseTracks : uniqueTracks([...becauseTracks, ...recommended, ...trending])).slice(0, 16);
  const loading = home.isLoading && !home.data;
  const failed = home.isError && !home.data;

  const mix = () => {
    const pool = uniqueTracks(shuffled([...liked.slice(0, 40), ...recent.slice(0, 20), ...becauseTracks.slice(0, 15)]));
    if (pool.length) playContext(pool, 0, "Your Mix");
  };

  return (
    <div className="fade-up pb-4">
      <Header name={name} />

      {/* top picks */}
      <section className="mb-9">
        {loading ? (
          <div className="flex gap-3.5 overflow-hidden px-4 desk:px-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[0.92] w-[min(70vw,320px)] shrink-0 rounded-[18px] desk:w-[300px]" />
            ))}
          </div>
        ) : (
          <>
            <SectionHeader title="Top picks for you" />
            <Shelf>
              {(liked.length > 0 || recent.length > 0) && (
                <HeroCard
                  eyebrow="Made for you"
                  title="Your Mix"
                  subtitle="Songs you love, and more like them"
                  artwork={liked[0]?.artwork || recent[0]?.artwork}
                  onClick={mix}
                />
              )}
              {seed && (
                <HeroCard
                  eyebrow="Because you listened to"
                  title={seed.title}
                  subtitle={`${seed.artist} · Song radio`}
                  artwork={seed.artwork}
                  onClick={() => void startRadio(seed)}
                />
              )}
              {topArtist && topArtist.artist !== seed?.artist && (
                <HeroCard
                  eyebrow="Your top artist"
                  title={`${topArtist.artist} Radio`}
                  subtitle="Their songs and similar music"
                  artwork={topArtist.artwork}
                  onClick={() => void startRadio(topArtist)}
                />
              )}
              {trending.length > 0 && (
                <HeroCard
                  eyebrow="Trending"
                  title="Today's Hits"
                  subtitle={trending
                    .slice(0, 3)
                    .map((t) => t.artist)
                    .join(", ")}
                  artwork={trending[0].artwork}
                  onClick={() => playContext(trending, 0, "Today's Hits")}
                />
              )}
              {(home.data?.newReleases ?? []).slice(0, 2).map((a) => (
                <HeroCard key={a.id} eyebrow="New music" title={a.title} subtitle={a.artist} artwork={a.artwork} href={`/album/${encodeURIComponent(a.id)}`} />
              ))}
            </Shelf>
          </>
        )}
      </section>

      {failed && (
        <EmptyState
          icon={<RefreshCw size={26} />}
          title="Can't reach the music service"
          desc="Your library still works. Try again in a moment."
          action={
            <Button variant="secondary" onClick={() => void home.refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {quick.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Quick picks" subtitle={seed ? `Inspired by ${seed.title}` : "Start here"} />
          <QuickPicks tracks={quick} label="Quick picks" />
        </section>
      )}

      {recent.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Recently played" href="/library/history" />
          <Shelf>
            {recent.map((t, i) => (
              <SongCard key={t.id} tracks={recent} index={i} label="Recently played" />
            ))}
          </Shelf>
        </section>
      )}

      <RoomInvite />

      {recommended.length > 0 && (
        <section className="mb-9">
          <SectionHeader title={home.data?.basedOnArtist ? `More from ${home.data.basedOnArtist}` : "Recommended for you"} />
          <Shelf>
            {recommended.map((t, i) => (
              <SongCard key={t.id} tracks={recommended} index={i} label={home.data?.basedOnArtist ? `More from ${home.data.basedOnArtist}` : "Recommended"} />
            ))}
          </Shelf>
        </section>
      )}

      {(home.data?.newReleases?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="New releases" href="/explore" />
          <Shelf>
            {home.data!.newReleases.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </section>
      )}

      {trending.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Trending now" />
          <Shelf>
            {trending.map((t, i) => (
              <SongCard key={t.id} tracks={trending} index={i} label="Trending now" />
            ))}
          </Shelf>
        </section>
      )}

      {(home.data?.topArtists?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="Artists to follow" />
          <Shelf>
            {home.data!.topArtists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </Shelf>
        </section>
      )}

      {liked.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="From your Liked Songs" href="/library/liked" />
          <Shelf>
            {liked.slice(0, 20).map((t, i) => (
              <SongCard key={t.id} tracks={liked} index={i} label="Liked Songs" />
            ))}
          </Shelf>
        </section>
      )}

      {loading && (
        <div className="space-y-9 px-4 desk:px-8">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k}>
              <Skeleton className="mb-3 h-6 w-44 rounded-md" />
              <div className="flex gap-3.5 overflow-hidden">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-[148px] shrink-0 desk:w-[168px]">
                    <Skeleton className="aspect-square w-full rounded-[12px]" />
                    <Skeleton className="mt-2 h-3.5 w-4/5 rounded" />
                    <Skeleton className="mt-1.5 h-3 w-3/5 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ name }: { name: string }) {
  const room = useRoomSummary();
  // Time of day is the visitor's, not the server's.
  const mounted = useMounted();
  return (
    <div className="flex items-end justify-between gap-3 px-4 pt-3 pb-4 desk:px-8 desk:pt-8">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 desk:hidden">
          <LogoMark size={22} />
          <span className="text-[13px] font-semibold text-fg-2">Sidify</span>
        </div>
        <h1 className="t-display truncate desk:t-headline">
          <span className="desk:hidden">Home</span>
          <span className="hidden desk:inline">
            {mounted ? greeting() : "Welcome back"}
            {name ? `, ${name.split(" ")[0]}` : ""}
          </span>
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 pb-1 desk:hidden">
        <Link
          href={room.code ? `/rooms/${room.code}` : "/rooms"}
          aria-label="Listen Together"
          className={room.inRoom ? "flex h-9 items-center gap-1 rounded-full bg-brand px-3 text-white" : "grid h-9 w-9 place-items-center rounded-full bg-fill"}
        >
          <PeopleGlyph size={18} />
          {room.inRoom && <span className="text-[12px] font-bold">{room.count}</span>}
        </Link>
        <Link href="/settings" aria-label="Settings" className="grid h-9 w-9 place-items-center rounded-full bg-fill">
          <Settings size={18} />
        </Link>
      </div>
    </div>
  );
}

function RoomInvite() {
  const room = useRoomSummary();
  if (room.inRoom) return null;
  return (
    <section className="mb-9 px-4 desk:px-8">
      <Link
        href="/rooms"
        className="group relative flex items-center gap-4 overflow-hidden rounded-[18px] bg-raised p-5 ring-1 ring-edge transition-colors hover:bg-raised-2"
      >
        <div
          className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, #fa2d48, transparent)" }}
        />
        <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-white">
          <PeopleGlyph size={28} />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[17px] font-bold tracking-[-0.2px]">Listen together</span>
          <span className="block text-[13.5px] leading-snug text-fg-2">Start a room, share the code, and everyone hears the same song at the same moment.</span>
        </span>
        <span className="relative hidden h-9 shrink-0 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-on-primary sm:inline-flex">
          Start a room
        </span>
      </Link>
    </section>
  );
}
