"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Clock3, Music4, Shuffle } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext } from "@/lib/audioEngine";
import { totalDuration, upscaleArtwork, yearOf } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { PlayButton } from "@/components/controls";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ef = useSettings((s) => s.explicitFilter);
  const { data, isLoading } = useQuery({ queryKey: ["album", id], queryFn: () => api.album(id), staleTime: 10 * 60_000 });

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-4 px-4 pt-8 md:px-7">
        <div className="shimmer h-64 rounded-[28px]" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shimmer h-12 rounded-xl" />
        ))}
      </div>
    );
  }

  const { album } = data;
  const tracks = ef ? data.tracks.filter((t) => !t.explicit) : data.tracks;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-8 md:px-7">
      {/* HERO */}
      <div className="relative -mx-4 mb-6 overflow-hidden md:-mx-7">
        <div className="absolute inset-0">
          <img
            src={upscaleArtwork(album.artwork, 600)}
            alt=""
            className="h-full w-full scale-150 object-cover blur-[100px] saturate-150 opacity-55"
          />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent, var(--bg) 95%)" }} />
        </div>
        <div className="relative flex flex-col items-start gap-6 px-4 pt-14 pb-6 sm:flex-row sm:items-end md:px-7 md:pt-20">
          <img
            src={upscaleArtwork(album.artwork, 500)}
            alt={album.title}
            className="w-44 rounded-2xl object-cover shadow-2xl md:w-56"
            style={{ boxShadow: "0 30px 80px -18px rgba(0,0,0,.75), 0 0 50px -18px var(--glow)" }}
          />
          <div className="min-w-0 flex-1">
            <div className="text-muted mb-1 text-[11px] font-bold tracking-[0.22em] uppercase">
              {(album.trackCount ?? tracks.length) <= 3 ? "Single" : "Album"}
            </div>
            <h1 className="font-display text-[30px] leading-[1.05] font-extrabold tracking-tight md:text-[46px]">{album.title}</h1>
            <div className="text-muted mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              {album.artistId ? (
                <Link href={`/artist/${album.artistId}`} className="font-semibold text-[var(--text)] hover:accent-text hover:underline">
                  {album.artist}
                </Link>
              ) : (
                <span className="font-semibold text-[var(--text)]">{album.artist}</span>
              )}
              <span>·</span>
              <span className="flex items-center gap-1">
                <Calendar size={12} /> {yearOf(album.releaseDate)}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Music4 size={12} /> {tracks.length} songs
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock3 size={12} /> {totalDuration(tracks)}
              </span>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <PlayButton size={54} onClick={() => tracks.length && playContext(tracks, 0, album.title)} label="Play album" />
              <button
                onClick={() => {
                  if (!tracks.length) return;
                  playContext(tracks, Math.floor(Math.random() * tracks.length), `${album.title} · Shuffle`);
                  import("@/store/player").then(({ usePlayer }) => usePlayer.getState().set({ shuffle: true }));
                }}
                className="glass flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-muted transition-colors hover:text-[var(--text)]"
              >
                <Shuffle size={16} /> Shuffle
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* TRACKLIST */}
      <div className="grid grid-cols-1 gap-x-8 xl:grid-cols-1">
        {tracks.map((_, i) => (
          <TrackRow key={tracks[i].id} tracks={tracks} index={i} numbered showArt={false} contextLabel={album.title} />
        ))}
      </div>

      <p className="text-muted-2 mt-6 px-3 text-[12px]">
        {yearOf(album.releaseDate)} · {album.genre || "Music"} · Streamed in {tracks.length ? "high fidelity previews" : "—"} via Sidify Engine
      </p>
    </div>
  );
}
