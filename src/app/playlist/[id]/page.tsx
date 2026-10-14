"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ListMusic, Pencil, Pin, Trash2, X } from "lucide-react";
import { api } from "@/lib/clientApi";
import { usePlaylists } from "@/lib/library";
import { playContext } from "@/lib/audioEngine";
import { useSettings } from "@/store/settings";
import { shuffled, totalDuration } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import CollectionHeader, { CollectionSkeleton, HeaderAction } from "@/components/CollectionHeader";
import { Button, ButtonLink, EmptyState, Sheet } from "@/components/ui";

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: playlist, isLoading } = useQuery({ queryKey: ["playlist", id], queryFn: () => api.playlist(id), staleTime: 10_000 });
  const { rename, remove, removeTrack } = usePlaylists();
  const pinned = useSettings((s) => s.pinnedPlaylists);
  const setSettings = useSettings((s) => s.set);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) return <CollectionSkeleton />;
  if (!playlist) {
    return <EmptyState title="Playlist not found" desc="It may have been deleted." action={<ButtonLink href="/library">Back to Library</ButtonLink>} />;
  }

  const tracks = playlist.tracks;
  const isPinned = pinned.includes(playlist.id);
  const saveName = async () => {
    if (name.trim() && name.trim() !== playlist.name) await rename(playlist.id, name.trim());
    setEditing(false);
  };

  return (
    <div className="fade-up">
      <CollectionHeader
        arts={tracks.slice(0, 4).map((t) => t.artwork)}
        cover={
          tracks.length ? undefined : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-600 to-zinc-800 text-white/80">
              <ListMusic size={64} strokeWidth={1.4} />
            </div>
          )
        }
        eyebrow="Playlist"
        title={
          editing ? (
            <span className="inline-flex max-w-full items-center gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                  if (e.key === "Escape") setEditing(false);
                }}
                maxLength={80}
                aria-label="Playlist name"
                className="min-w-0 flex-1 rounded-[10px] bg-white/15 px-3 py-1 text-[0.8em] font-bold text-white outline-none"
              />
              <button type="button" aria-label="Save" onClick={() => void saveName()} className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
                <Check size={18} />
              </button>
              <button type="button" aria-label="Cancel" onClick={() => setEditing(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
                <X size={18} />
              </button>
            </span>
          ) : (
            playlist.name
          )
        }
        meta={`${tracks.length} song${tracks.length === 1 ? "" : "s"}${tracks.length ? ` · ${totalDuration(tracks)}` : ""}`}
        disabled={!tracks.length}
        onPlay={() => playContext(tracks, 0, playlist.name)}
        onShuffle={() => playContext(shuffled(tracks), 0, playlist.name)}
        action={
          <>
            <HeaderAction
              label="Rename"
              onClick={() => {
                setName(playlist.name);
                setEditing(true);
              }}
            >
              <Pencil size={17} />
            </HeaderAction>
            <HeaderAction
              label={isPinned ? "Unpin" : "Pin to the top of Library"}
              active={isPinned}
              onClick={() => setSettings({ pinnedPlaylists: isPinned ? pinned.filter((x) => x !== playlist.id) : [playlist.id, ...pinned] })}
            >
              <Pin size={17} />
            </HeaderAction>
            <HeaderAction label="Delete playlist" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={17} />
            </HeaderAction>
          </>
        }
      />

      {tracks.length === 0 ? (
        <EmptyState
          icon={<ListMusic size={28} />}
          title="This playlist is empty"
          desc="Open any song's menu and choose “Add to playlist…”."
          action={<ButtonLink href="/search">Find songs</ButtonLink>}
        />
      ) : (
        <div className="px-2 desk:px-6">
          {tracks.map((t, i) => (
            <TrackRow
              key={t.id}
              tracks={tracks}
              index={i}
              contextLabel={playlist.name}
              onRemove={() => void removeTrack(playlist.id, t.id)}
              removeLabel="Remove from playlist"
            />
          ))}
        </div>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete playlist?" subtitle={`“${playlist.name}” will be removed from your library.`} width={400}>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await remove(playlist.id);
              setSettings({ pinnedPlaylists: pinned.filter((x) => x !== playlist.id) });
              router.push("/library");
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
