"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shuffle, UserCheck, UserPlus } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext } from "@/lib/audioEngine";
import { useFollowed } from "@/lib/library";
import { upscaleArtwork, cx } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { AlbumCard } from "@/components/cards";
import { PlayButton } from "@/components/controls";

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ef = useSettings((s) => s.explicitFilter);
  const { data, isLoading } = useQuery({ queryKey: ["artist", id], queryFn: () => api.artist(id), staleTime: 5 * 60_000 });
  const { data: followedData, toggle } = useFollowed();
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [discFilter, setDiscFilter] = useState<"all" | "albums" | "singles">("all");

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-4 px-4 pt-8 md:px-7">
        <div className="shimmer h-56 rounded-[28px]" />
        <div className="shimmer h-14 rounded-xl" />
        <div className="shimmer h-14 rounded-xl" />
        <div className="shimmer h-14 rounded-xl" />
      </div>
    );
  }

  const { artist, albums } = data;
  const songs = ef ? data.songs.filter((t) => !t.explicit) : data.songs;
  const bannerArt = songs[0]?.artwork || albums[0]?.artwork || "";
  const following = followedData?.artists.some((a) => a.artistId === artist.id) ?? false;

  const disc = albums.filter((a) => {
    if (discFilter === "albums") return (a.trackCount ?? 10) > 3;
    if (discFilter === "singles") return (a.trackCount ?? 10) <= 3;
    return true;
  });

  const visibleSongs = showAllSongs ? songs : songs.slice(0, 5);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-8 md:px-7">
      {/* HERO */}
      <div className="relative -mx-4 mb-6 overflow-hidden md:-mx-7">
        <div className="absolute inset-0">
          {bannerArt && (
            <img src={upscaleArtwork(bannerArt, 600)} alt="" className="h-full w-full scale-150 object-cover blur-[90px] saturate-150 opacity-60" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent, var(--bg) 94%)" }} />
        </div>
        <div className="relative flex flex-col items-start gap-6 px-4 pt-16 pb-6 sm:flex-row sm:items-end md:px-7 md:pt-24">
          {bannerArt ? (
            <img
              src={upscaleArtwork(bannerArt, 400)}
              alt={artist.name}
              className="h-40 w-40 rounded-full border-4 border-[var(--bg-deep)] object-cover shadow-2xl md:h-48 md:w-48"
              style={{ boxShadow: "0 30px 80px -20px rgba(0,0,0,.7), 0 0 60px -20px var(--glow)" }}
            />
          ) : (
            <div className="grid h-40 w-40 place-items-center rounded-full bg-[var(--panel-strong)] font-display text-6xl font-bold md:h-48 md:w-48">
              {artist.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="accent-text mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.22em] uppercase">
              Verified Artist
            </div>
            <h1 className="font-display truncate text-[36px] leading-none font-extrabold tracking-tight md:text-[56px]">
              {artist.name}
            </h1>
            <p className="text-muted mt-2.5 text-[13.5px]">
              {artist.genre ? `${artist.genre} · ` : ""}
              {albums.length} releases · {songs.length} top tracks
            </p>
            <div className="mt-5 flex items-center gap-3">
              <PlayButton size={54} onClick={() => songs.length && playContext(songs, 0, artist.name)} label={`Play ${artist.name}`} />
              <button
                onClick={() => {
                  if (!songs.length) return;
                  const idx = Math.floor(Math.random() * songs.length);
                  playContext(songs, idx, `${artist.name} · Shuffle`);
                  import("@/store/player").then(({ usePlayer }) => usePlayer.getState().set({ shuffle: true }));
                }}
                className="glass grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:text-[var(--text)]"
                aria-label="Shuffle play"
              >
                <Shuffle size={18} />
              </button>
              <button
                onClick={() => void toggle({ id: artist.id, name: artist.name, genre: artist.genre, artwork: bannerArt }, !following)}
                className={cx(
                  "flex items-center gap-2 rounded-full border px-5 py-2.5 text-[13px] font-bold transition-all",
                  following
                    ? "accent-text border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
                    : "border-[var(--border)] hover:border-[var(--muted)]"
                )}
              >
                {following ? <UserCheck size={16} /> : <UserPlus size={16} />}
                {following ? "Following" : "Follow"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TOP SONGS */}
      {songs.length > 0 && (
        <section className="mb-9">
          <h2 className="font-display mb-2 px-1 text-[20px] font-bold">Top songs</h2>
          <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
            {visibleSongs.map((_, i) => (
              <TrackRow key={songs[i].id} tracks={songs} index={i} numbered contextLabel={artist.name} />
            ))}
          </div>
          {songs.length > 5 && (
            <button
              onClick={() => setShowAllSongs((v) => !v)}
              className="text-muted mt-3 px-3 text-[12.5px] font-bold tracking-wider uppercase hover:accent-text"
            >
              {showAllSongs ? "Show less" : `Show all ${songs.length}`}
            </button>
          )}
        </section>
      )}

      {/* DISCOGRAPHY */}
      {albums.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
            <h2 className="font-display text-[20px] font-bold">Discography</h2>
            <div className="flex gap-2">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "albums", label: "Albums" },
                  { id: "singles", label: "Singles & EPs" },
                ] as const
              ).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setDiscFilter(c.id)}
                  className={cx(
                    "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold",
                    discFilter === c.id ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {disc.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
