"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { useSettings } from "@/store/settings";
import { api } from "@/lib/clientApi";
import type { Track } from "@/lib/types";
import { upscaleArtwork } from "@/lib/format";
import { playContext } from "@/lib/audioEngine";
import Section from "@/components/Section";
import TrackRow from "@/components/TrackRow";
import { AlbumCard, ArtistCard, SongTile } from "@/components/cards";
import { AppPromoBanner } from "@/components/AppPromo";
import SidifyLogo from "@/components/SidifyLogo";
import { DeluxeArtDots } from "@/components/DeluxeBackdrop";

const MOODS = [
  { name: "Pop", q: "pop hits", g: "from-fuchsia-500 to-purple-700" },
  { name: "Lo-Fi", q: "lofi beats", g: "from-teal-400 to-emerald-600" },
  { name: "Workout", q: "workout edm", g: "from-orange-500 to-red-600" },
  { name: "Chill", q: "chill vibes", g: "from-sky-400 to-blue-600" },
  { name: "Classical", q: "classical piano", g: "from-amber-300 to-yellow-600" },
  { name: "Party", q: "party dance", g: "from-pink-500 to-rose-600" },
  { name: "Focus", q: "deep focus instrumental", g: "from-indigo-400 to-violet-700" },
  { name: "Romance", q: "romantic songs", g: "from-rose-400 to-pink-700" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night vibes";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

export default function HomePage() {
  const region = useSettings((s) => s.region);
  const ef = useSettings((s) => s.explicitFilter);
  const name = useSettings((s) => s.profileName);
  const { data, isLoading } = useQuery({
    queryKey: ["home", region],
    queryFn: () => api.home(region),
    staleTime: 5 * 60_000,
  });

  const vis = (arr: Track[]) => (ef ? arr.filter((t) => !t.explicit) : arr);
  const trending = vis(data?.trending ?? []);
  const recommended = vis(data?.recommended ?? []);
  const recent = vis(data?.recentlyPlayed ?? []);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-5 md:px-7 md:pt-7">
      {/* ANDROID APP PROMO — the unmissable one, first thing on the page */}
      <AppPromoBanner />

      {/* HERO — sits directly on the rotating deluxe artwork */}
      <div className="glass relative mb-7 overflow-hidden rounded-[28px] p-6 pb-16 md:p-9">
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(120deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent 55%)" }} />
        <div className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }} />
        <div className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative">
          <div className="mb-5 flex items-center gap-2.5">
            <SidifyLogo size={30} />
            <span className="text-muted text-[11px] font-bold tracking-[0.28em] uppercase">Sidify · Stream beyond limits</span>
          </div>
          <h1 className="font-display max-w-xl text-[30px] leading-[1.08] font-extrabold tracking-tight md:text-[44px]">
            {greeting()}
            {name ? `, ${name.split(" ")[0]}` : ""}.<br />
            <span className="accent-text text-glow">Your universe of sound</span> awaits.
          </h1>
          <p className="text-muted mt-3 max-w-md text-[14px] leading-6">
            Instant search, offline downloads, a real-time studio equalizer and buttery crossfade — all in one neon playground.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => trending.length && playContext(trending, 0, "Trending Now")}
              className="ring-focus flex items-center gap-2 rounded-full accent-bg px-5 py-2.5 text-[13.5px] font-bold text-black transition-transform hover:scale-[1.03] active:scale-95"
              style={{ boxShadow: "0 12px 34px -8px var(--glow)" }}
            >
              <Sparkles size={16} /> Play today&apos;s mix
            </button>
            <Link
              href="/search"
              className="glass flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition-transform hover:scale-[1.03]"
            >
              Explore music <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        {/* backdrop slideshow controls — 12 artworks, auto-changing */}
        <div className="absolute right-4 bottom-4 md:right-6 md:bottom-5">
          <DeluxeArtDots />
        </div>
      </div>

      {/* QUICK PICKS */}
      {isLoading ? (
        <GridSkeleton />
      ) : (
        recommended.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display mb-3 px-1 text-[19px] font-bold tracking-tight md:text-[21px]">
              {data?.basedOnArtist ? `More like ${data.basedOnArtist}` : "Made for you"}
            </h2>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {recommended.slice(0, 6).map((t, i) => (
                <SongTile key={t.id} track={t} onPlay={() => playContext(recommended, i, "Made for you")} />
              ))}
            </div>
          </div>
        )
      )}

      {/* MOODS */}
      <div className="mb-8">
        <h2 className="font-display mb-3 px-1 text-[19px] font-bold tracking-tight md:text-[21px]">Mood & genres</h2>
        <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {MOODS.map((m) => (
            <Link
              key={m.name}
              href={`/search?q=${encodeURIComponent(m.q)}`}
              className={`relative h-[86px] w-[132px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br ${m.g} p-3.5 transition-transform hover:scale-[1.04] active:scale-95`}
            >
              <span className="font-display text-[15px] font-bold text-white drop-shadow">{m.name}</span>
              <span className="absolute -right-4 -bottom-5 h-16 w-16 rotate-[20deg] rounded-xl bg-white/15" />
            </Link>
          ))}
        </div>
      </div>

      {/* TRENDING */}
      {trending.length > 0 && (
        <div className="mb-8">
          <Section
            title="Trending now"
            subtitle="The most-played tracks this week"
            action={
              <Link href={`/search?q=top hits`} className="text-muted text-[12px] font-semibold uppercase tracking-wider hover:accent-text">
                Show all
              </Link>
            }
          >
            {trending.slice(0, 10).map((t, i) => (
              <TrackCard key={t.id} tracks={trending} index={i} />
            ))}
          </Section>
        </div>
      )}

      {/* NEW RELEASES */}
      {(data?.newReleases?.length ?? 0) > 0 && (
        <div className="mb-8">
          <Section title="New releases" subtitle="Fresh albums & singles">
            {data!.newReleases.map((a) => (
              <div key={a.id} className="w-[168px] shrink-0 snap-start md:w-[186px]">
                <AlbumCard album={a} />
              </div>
            ))}
          </Section>
        </div>
      )}

      {/* TOP ARTISTS */}
      {(data?.topArtists?.length ?? 0) > 0 && (
        <div className="mb-8">
          <Section title="Top artists" subtitle="Commanding the charts right now">
            {data!.topArtists.map((a) => (
              <div key={a.id} className="w-[150px] shrink-0 snap-start md:w-[168px]">
                <ArtistCard artist={a} />
              </div>
            ))}
          </Section>
        </div>
      )}

      {/* RECOMMENDED LIST */}
      {recommended.length > 6 && (
        <div className="mb-8">
          <h2 className="font-display mb-3 px-1 text-[19px] font-bold tracking-tight md:text-[21px]">Recommended for you</h2>
          <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
            {recommended.slice(6, 14).map((_, i) => (
              <TrackRow key={recommended[i + 6].id} tracks={recommended} index={i + 6} contextLabel="Recommended" />
            ))}
          </div>
        </div>
      )}

      {/* RECENTLY PLAYED */}
      {recent.length > 0 && (
        <div className="mb-8">
          <Section title="Recently played" subtitle="Jump back in">
            {recent.slice(0, 8).map((t, i) => (
              <div key={t.id} className="w-[290px] shrink-0 snap-start">
                <SongTile track={t} onPlay={() => playContext(recent, i, "Recently played")} />
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function TrackCard({ tracks, index }: { tracks: Track[]; index: number }) {
  const t = tracks[index];
  return (
    <button
      onClick={() => playContext(tracks, index, "Trending now")}
      onContextMenu={(e) => {
        e.preventDefault();
        import("@/store/ui").then(({ useUi }) => useUi.getState().openMenu({ track: t, x: e.clientX, y: e.clientY }));
      }}
      className="hover-panel group w-[168px] shrink-0 snap-start rounded-2xl border border-transparent p-3 text-left md:w-[186px]"
    >
      <div className="relative mb-3 aspect-square overflow-hidden rounded-xl">
        <img
          src={upscaleArtwork(t.artwork, 400)}
          alt={t.title}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
        />
        <span className="absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
          #{index + 1}
        </span>
      </div>
      <div className="truncate text-[14px] font-semibold">{t.title}</div>
      <div className="text-muted truncate text-[12.5px]">{t.artist}</div>
    </button>
  );
}

function GridSkeleton() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="shimmer h-14 rounded-xl" />
      ))}
    </div>
  );
}
