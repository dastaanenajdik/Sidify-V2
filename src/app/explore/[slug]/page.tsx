"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Play, Shuffle } from "lucide-react";
import { api } from "@/lib/clientApi";
import { moodBySlug } from "@/lib/explore";
import { playContext } from "@/lib/audioEngine";
import { useSettings } from "@/store/settings";
import { shuffled } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { AlbumCard, ArtistCard } from "@/components/cards";
import { Button, EmptyState, SectionHeader, Shelf, Skeleton } from "@/components/ui";

export default function MoodPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const mood = moodBySlug(slug);
  if (!mood) notFound();
  const region = useSettings((s) => s.region);
  const ef = useSettings((s) => s.explicitFilter);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["mood", mood.slug, region],
    queryFn: () => api.search(mood.q, "all", region, 30),
    staleTime: 30 * 60_000,
  });
  const songs = (data?.songs ?? []).filter((t) => !ef || !t.explicit);
  const label = mood.title;

  return (
    <div className="fade-up">
      <div className="relative overflow-hidden px-4 pt-8 pb-7 desk:px-8 desk:pt-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${mood.color} 70%, transparent), transparent)` }}
        />
        <div className="relative">
          <div className="t-eyebrow text-fg/70">{mood.kind === "mood" ? "Mood" : "Genre"}</div>
          <h1 className="t-display mt-1 desk:text-[48px] desk:tracking-[-1.2px]">{mood.title}</h1>
          <div className="mt-5 flex gap-2.5">
            <Button disabled={!songs.length} onClick={() => playContext(songs, 0, label)}>
              <Play size={16} fill="currentColor" /> Play
            </Button>
            <Button variant="secondary" disabled={!songs.length} onClick={() => playContext(shuffled(songs), 0, label)}>
              <Shuffle size={16} /> Shuffle
            </Button>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2 px-4 desk:px-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] rounded-[8px]" />
          ))}
        </div>
      )}

      {isError && (
        <EmptyState
          title="Couldn't load this page"
          desc="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
          }
        />
      )}

      {songs.length > 0 && (
        <section className="mb-9">
          <SectionHeader title="Songs" />
          <div className="grid grid-cols-1 gap-x-8 px-2 desk:px-6 xl:grid-cols-2">
            {songs.slice(0, 20).map((_, i) => (
              <TrackRow key={songs[i].id} tracks={songs} index={i} contextLabel={label} />
            ))}
          </div>
        </section>
      )}

      {(data?.albums?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="Albums & playlists" />
          <Shelf>
            {data!.albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </section>
      )}

      {(data?.artists?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="Artists" />
          <Shelf>
            {data!.artists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </Shelf>
        </section>
      )}
    </div>
  );
}
