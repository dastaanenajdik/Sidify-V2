"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext } from "@/lib/audioEngine";
import { downloadTrackFlow } from "@/lib/library";
import { shuffled, totalDuration, yearOf } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import CollectionHeader, { CollectionSkeleton, HeaderAction } from "@/components/CollectionHeader";
import { Button, EmptyState } from "@/components/ui";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ef = useSettings((s) => s.explicitFilter);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["album", id], queryFn: () => api.album(id), staleTime: 10 * 60_000 });

  if (isLoading) return <CollectionSkeleton />;
  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't open this album"
        desc="It may be unavailable right now."
        action={
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const { album } = data;
  const tracks = ef ? data.tracks.filter((t) => !t.explicit) : data.tracks;
  const count = album.trackCount ?? tracks.length;
  const kind = count <= 3 ? "Single" : "Album";
  const meta = [kind, yearOf(album.releaseDate), `${tracks.length} song${tracks.length === 1 ? "" : "s"}`, tracks.length ? totalDuration(tracks) : ""]
    .filter(Boolean)
    .join(" · ");
  const label = album.title;

  return (
    <div className="fade-up">
      <CollectionHeader
        artwork={album.artwork}
        title={album.title}
        subtitle={
          album.artistId ? (
            <Link href={`/artist/${encodeURIComponent(album.artistId)}`} className="hover:underline">
              {album.artist}
            </Link>
          ) : (
            album.artist
          )
        }
        meta={meta}
        disabled={!tracks.length}
        onPlay={() => playContext(tracks, 0, label)}
        onShuffle={() => playContext(shuffled(tracks), 0, label)}
        action={
          tracks[0] ? (
            <HeaderAction label="Download" onClick={() => tracks.forEach((t, i) => void downloadTrackFlow(t, { silent: i > 0 }))}>
              <Download size={18} />
            </HeaderAction>
          ) : null
        }
      />

      <div className="px-2 desk:px-6">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} tracks={tracks} index={i} contextLabel={label} numbered subtitle={t.artist !== album.artist ? t.artist : undefined} />
        ))}
        {!tracks.length && <EmptyState title="No playable songs" desc="This release has nothing we can play right now." />}
      </div>

      {tracks.length > 0 && (
        <p className="px-4 pt-5 text-[13px] text-fg-2 desk:px-8">
          {album.releaseDate ? new Date(album.releaseDate).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : ""}
          {album.releaseDate ? " · " : ""}
          {tracks.length} songs, {totalDuration(tracks)}
        </p>
      )}
    </div>
  );
}
