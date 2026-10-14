"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Play } from "lucide-react";
import { api } from "@/lib/clientApi";
import { playContext } from "@/lib/audioEngine";
import { useUi } from "@/store/ui";
import { uniqueTracks } from "@/lib/format";
import TrackRow from "@/components/TrackRow";
import { Button, ButtonLink, EmptyState, PageTitle, Skeleton } from "@/components/ui";

export default function HistoryPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["recent"], queryFn: api.recent, staleTime: 15_000 });
  const tracks = uniqueTracks(data?.tracks ?? []);

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          tracks.length ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => playContext(tracks, 0, "History")}>
                <Play size={14} fill="currentColor" /> Play
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.clearRecent();
                  qc.invalidateQueries({ queryKey: ["recent"] });
                  qc.invalidateQueries({ queryKey: ["home"] });
                  useUi.getState().pushToast({ title: "History cleared", kind: "ok" });
                }}
              >
                Clear
              </Button>
            </>
          ) : null
        }
      >
        History
      </PageTitle>
      {isLoading ? (
        <div className="space-y-2 px-4 desk:px-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] rounded-[8px]" />
          ))}
        </div>
      ) : tracks.length ? (
        <div className="px-2 desk:px-6">
          {tracks.map((t, i) => (
            <TrackRow key={t.id} tracks={tracks} index={i} contextLabel="History" />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Clock3 size={28} />} title="Nothing played yet" desc="Songs you play show up here." action={<ButtonLink href="/">Go home</ButtonLink>} />
      )}
    </div>
  );
}
