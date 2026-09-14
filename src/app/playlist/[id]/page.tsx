"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ListMusic, Pencil, Plus, Search, Shuffle, Trash2, X } from "lucide-react";
import { api } from "@/lib/clientApi";
import { usePlaylists } from "@/lib/library";
import { playContext } from "@/lib/audioEngine";
import { totalDuration, upscaleArtwork } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { PlayButton } from "@/components/controls";

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: playlist, isLoading } = useQuery({
    queryKey: ["playlist", id],
    queryFn: () => api.playlist(id),
    staleTime: 10_000,
  });
  const { rename, remove } = usePlaylists();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  if (isLoading || !playlist) {
    return (
      <div className="mx-auto max-w-[1280px] space-y-3 px-4 pt-8 md:px-7">
        <div className="shimmer h-56 rounded-[28px]" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="shimmer h-12 rounded-xl" />
        ))}
      </div>
    );
  }

  const tracks = playlist.tracks;
  const arts = tracks.slice(0, 4).map((t) => t.artwork);

  const saveName = async () => {
    if (name.trim()) await rename(playlist.id, name.trim());
    setEditing(false);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-8 md:px-7">
      <div className="relative -mx-4 mb-6 overflow-hidden md:-mx-7">
        <div className="absolute inset-0">
          {arts[0] && (
            <img src={upscaleArtwork(arts[0], 600)} alt="" className="h-full w-full scale-150 object-cover blur-[100px] opacity-50 saturate-150" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent, var(--bg) 95%)" }} />
        </div>
        <div className="relative flex flex-col items-start gap-6 px-4 pt-14 pb-6 sm:flex-row sm:items-end md:px-7">
          <div className="h-44 w-44 shrink-0 overflow-hidden rounded-2xl shadow-2xl md:h-52 md:w-52">
            {arts.length >= 4 ? (
              <div className="grid h-full w-full grid-cols-2 grid-rows-2">
                {arts.map((a, i) => (
                  <img key={i} src={a} alt="" className="h-full w-full object-cover" />
                ))}
              </div>
            ) : arts[0] ? (
              <img src={upscaleArtwork(arts[0], 500)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center bg-[var(--panel-strong)]">
                <ListMusic size={44} className="text-muted-2" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-muted mb-1 text-[11px] font-bold tracking-[0.22em] uppercase">Playlist</div>
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveName()}
                  className="glass w-full max-w-md rounded-xl px-4 py-2 text-[24px] font-bold outline-none md:text-[34px]"
                  maxLength={80}
                />
                <button aria-label="Save name" onClick={() => void saveName()} className="accent-text grid h-10 w-10 place-items-center rounded-full">
                  <Check size={20} />
                </button>
                <button aria-label="Cancel" onClick={() => setEditing(false)} className="text-muted grid h-10 w-10 place-items-center rounded-full">
                  <X size={20} />
                </button>
              </div>
            ) : (
              <h1 className="font-display flex items-center gap-3 text-[30px] leading-tight font-extrabold tracking-tight md:text-[42px]">
                <span className="truncate">{playlist.name}</span>
                <button
                  aria-label="Rename playlist"
                  onClick={() => {
                    setName(playlist.name);
                    setEditing(true);
                  }}
                  className="text-muted-2 shrink-0 transition-colors hover:text-[var(--text)]"
                >
                  <Pencil size={18} />
                </button>
              </h1>
            )}
            <p className="text-muted mt-2 text-[13px]">
              {tracks.length} songs{tracks.length > 0 ? ` · ${totalDuration(tracks)}` : ""}
            </p>
            <div className="mt-5 flex items-center gap-3">
              {tracks.length > 0 && (
                <>
                  <PlayButton size={52} onClick={() => playContext(tracks, 0, playlist.name)} label="Play playlist" />
                  <button
                    onClick={() => {
                      playContext(tracks, Math.floor(Math.random() * tracks.length), `${playlist.name} · Shuffle`);
                      import("@/store/player").then(({ usePlayer }) => usePlayer.getState().set({ shuffle: true }));
                    }}
                    className="glass grid h-11 w-11 place-items-center rounded-full text-muted hover:text-[var(--text)]"
                    aria-label="Shuffle play"
                  >
                    <Shuffle size={17} />
                  </button>
                </>
              )}
              <button
                onClick={async () => {
                  await remove(playlist.id);
                  router.push("/library");
                }}
                className="glass grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:text-red-400"
                aria-label="Delete playlist"
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="glass mx-auto mt-8 flex max-w-md flex-col items-center rounded-3xl px-8 py-14 text-center">
          <ListMusic size={32} className="text-muted mb-4" />
          <h3 className="font-display text-[18px] font-bold">This playlist is empty</h3>
          <p className="text-muted mt-2 text-[13.5px]">
            Open any song&apos;s menu and choose “Add to playlist”, or pick songs from search.
          </p>
          <Link
            href="/search"
            className="mt-5 inline-flex items-center gap-2 rounded-full accent-bg px-5 py-2.5 text-[13px] font-bold text-black"
          >
            <Plus size={15} /> Add songs <Search size={14} className="opacity-70" />
          </Link>
        </div>
      ) : (
        <div>
          {tracks.map((_, i) => (
            <TrackRow key={tracks[i].id} tracks={tracks} index={i} numbered contextLabel={playlist.name} />
          ))}
        </div>
      )}
    </div>
  );
}
