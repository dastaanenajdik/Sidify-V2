"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Radio } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext, startRadio } from "@/lib/audioEngine";
import { useFollowed } from "@/lib/library";
import { shuffled } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { AlbumCard } from "@/components/cards";
import CollectionHeader, { CollectionSkeleton, HeaderAction } from "@/components/CollectionHeader";
import { Button, Chips, EmptyState, SectionHeader, Shelf } from "@/components/ui";

type Disc = "all" | "albums" | "singles";

export default function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ef = useSettings((s) => s.explicitFilter);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["artist", id], queryFn: () => api.artist(id), staleTime: 5 * 60_000 });
  const { data: followedData, toggle } = useFollowed();
  const [showAll, setShowAll] = useState(false);
  const [disc, setDisc] = useState<Disc>("all");

  if (isLoading) return <CollectionSkeleton />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't open this artist"
        desc="Check your connection and try again."
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const { artist, albums } = data;
  const songs = ef ? data.songs.filter((t) => !t.explicit) : data.songs;
  const banner = artist.artwork || songs[0]?.artwork || albums[0]?.artwork || "";
  const following = followedData?.artists.some((a) => a.artistId === artist.id) ?? false;
  const visible = showAll ? songs : songs.slice(0, 5);
  const filtered = albums.filter((a) => (disc === "albums" ? (a.trackCount ?? 10) > 3 : disc === "singles" ? (a.trackCount ?? 10) <= 3 : true));

  return (
    <div className="fade-up">
      <CollectionHeader
        artwork={banner}
        eyebrow="Artist"
        title={artist.name}
        meta={[artist.genre, albums.length ? `${albums.length} releases` : "", songs.length ? `${songs.length} top songs` : ""].filter(Boolean).join(" · ")}
        disabled={!songs.length}
        onPlay={() => playContext(songs, 0, artist.name)}
        onShuffle={() => playContext(shuffled(songs), 0, artist.name)}
        action={
          <>
            <HeaderAction
              label={following ? "Following" : "Follow"}
              active={following}
              onClick={() => void toggle({ id: artist.id, name: artist.name, genre: artist.genre, artwork: banner }, !following)}
            >
              {following ? <Check size={18} /> : <Plus size={19} />}
            </HeaderAction>
            {songs[0] && (
              <HeaderAction label={`${artist.name} radio`} onClick={() => void startRadio(songs[0])}>
                <Radio size={18} />
              </HeaderAction>
            )}
          </>
        }
      />

      {songs.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Top songs" onMore={songs.length > 5 ? () => setShowAll((v) => !v) : undefined} />
          <div className="grid grid-cols-1 gap-x-8 px-2 desk:px-6 xl:grid-cols-2">
            {visible.map((t, i) => (
              <TrackRow key={t.id} tracks={songs} index={i} contextLabel={artist.name} />
            ))}
          </div>
          {songs.length > 5 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 px-4 text-[14px] font-semibold text-playing desk:px-8">
              {showAll ? "Show less" : `Show all ${songs.length}`}
            </button>
          )}
        </section>
      )}

      {albums.length > 0 && (
        <section className="mb-9">
          <SectionHeader
            title="Discography"
            trailing={
              <Chips
                size="sm"
                value={disc}
                onChange={setDisc}
                options={[
                  { id: "all", label: "All" },
                  { id: "albums", label: "Albums" },
                  { id: "singles", label: "Singles & EPs" },
                ]}
              />
            }
          />
          <Shelf>
            {filtered.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </section>
      )}

      {!songs.length && !albums.length && <EmptyState title="Nothing here yet" desc="We couldn't find music for this artist." />}
    </div>
  );
}
