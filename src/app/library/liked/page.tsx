"use client";

import { Heart } from "lucide-react";
import { useLiked } from "@/lib/library";
import { playContext } from "@/lib/audioEngine";
import { useSettings } from "@/store/settings";
import { shuffled, totalDuration } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import CollectionHeader, { CollectionSkeleton } from "@/components/CollectionHeader";
import { ButtonLink, EmptyState } from "@/components/ui";

export default function LikedPage() {
  const { data, isLoading } = useLiked();
  const ef = useSettings((s) => s.explicitFilter);
  const tracks = (data?.tracks ?? []).filter((t) => !ef || !t.explicit);
  if (isLoading && !data) return <CollectionSkeleton />;

  return (
    <div className="fade-up">
      <CollectionHeader
        cover={
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#ff5b6e] to-[#a0142a]">
            <Heart size={96} fill="white" strokeWidth={0} className="drop-shadow-[0_8px_24px_rgba(0,0,0,.3)]" />
          </div>
        }
        eyebrow="Playlist"
        title="Liked Songs"
        meta={`${tracks.length} song${tracks.length === 1 ? "" : "s"}${tracks.length ? ` · ${totalDuration(tracks)}` : ""}`}
        disabled={!tracks.length}
        onPlay={() => playContext(tracks, 0, "Liked Songs")}
        onShuffle={() => playContext(shuffled(tracks), 0, "Liked Songs")}
      />
      {tracks.length ? (
        <div className="px-2 desk:px-6">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} tracks={tracks} index={i} contextLabel="Liked Songs" />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Heart size={28} />}
          title="Songs you love live here"
          desc="Tap the heart on any song and it'll be saved to this list."
          action={<ButtonLink href="/explore">Find something</ButtonLink>}
        />
      )}
    </div>
  );
}
