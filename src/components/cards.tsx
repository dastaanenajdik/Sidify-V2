"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import type { Album, Artist, Track } from "@/lib/types";
import { upscaleArtwork } from "@/lib/format";
import { api } from "@/lib/clientApi";
import { playContext } from "@/lib/audioEngine";
import { useUi } from "@/store/ui";

function useAsyncPlay() {
  const [loading, setLoading] = useState(false);
  const pushToast = useUi((s) => s.pushToast);
  const run = async (fn: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try {
      await fn();
    } catch {
      pushToast({ title: "Couldn't start playback", kind: "warn" });
    } finally {
      setLoading(false);
    }
  };
  return { loading, run };
}

function HoverPlay({ loading, onClick }: { loading: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      aria-label="Play"
      onClick={onClick}
      className="absolute right-3 bottom-3 grid h-11 w-11 translate-y-2 place-items-center rounded-full accent-bg text-black opacity-0 shadow-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105"
      style={{ boxShadow: "0 10px 28px -6px var(--glow)" }}
    >
      {loading ? <Loader2 size={19} className="animate-spin" /> : <Play size={19} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />}
    </button>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  const { loading, run } = useAsyncPlay();
  return (
    <div className="group relative w-full">
      <Link
        href={`/album/${album.id}`}
        className="hover-panel block rounded-2xl border border-transparent p-3"
        draggable={false}
      >
        <div className="relative mb-3 aspect-square overflow-hidden rounded-xl">
          <img
            src={upscaleArtwork(album.artwork, 400)}
            alt={album.title}
            loading="lazy"
            draggable={false}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="truncate text-[14.5px] font-semibold">{album.title}</div>
        <div className="text-muted truncate text-[12.5px]">
          {album.releaseDate ? new Date(album.releaseDate).getFullYear() + " · " : ""}
          {album.artist}
        </div>
      </Link>
      <HoverPlay
        loading={loading}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void run(async () => {
            const { tracks } = await api.album(album.id);
            playContext(tracks, 0, album.title);
          });
        }}
      />
    </div>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  const { loading, run } = useAsyncPlay();
  return (
    <div className="group relative">
      <Link href={`/artist/${encodeURIComponent(artist.id)}`} className="hover-panel block rounded-2xl border border-transparent p-3" draggable={false}>
        <div className="relative mb-3 aspect-square overflow-hidden rounded-full">
          {artist.artwork ? (
            <img
              src={upscaleArtwork(artist.artwork, 400)}
              alt={artist.name}
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-[var(--panel-strong)] font-display text-4xl font-bold text-muted">
              {artist.name.charAt(0)}
            </div>
          )}
        </div>
        <div className="truncate text-center text-[14.5px] font-semibold">{artist.name}</div>
        <div className="text-muted text-center text-[12.5px]">{artist.genre || "Artist"}</div>
      </Link>
      <HoverPlay
        loading={loading}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void run(async () => {
            const { songs, artist: a } = await api.artist(artist.id);
            playContext(songs, 0, a.name);
          });
        }}
      />
    </div>
  );
}

/** Compact horizontal tile (quick picks / mixes) */
export function SongTile({ track, onPlay }: { track: Track; onPlay?: () => void }) {
  return (
    <button
      onClick={onPlay}
      className="hover-panel group flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] text-left"
    >
      <img
        src={track.artwork}
        alt=""
        loading="lazy"
        draggable={false}
        className="h-14 w-14 shrink-0 object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold">{track.title}</div>
        <div className="text-muted truncate text-[12px]">{track.artist}</div>
      </div>
      <span className="mr-3 grid h-9 w-9 shrink-0 place-items-center rounded-full accent-bg text-black opacity-0 transition-opacity group-hover:opacity-100">
        <Play size={15} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
      </span>
    </button>
  );
}
