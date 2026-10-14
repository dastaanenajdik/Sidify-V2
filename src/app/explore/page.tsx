"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { MOODS } from "@/lib/explore";
import { AlbumCard, MoodCard, QuickPicks } from "@/components/cards";
import { PageTitle, SectionHeader, Shelf, Skeleton } from "@/components/ui";

export default function ExplorePage() {
  const region = useSettings((s) => s.region);
  const ef = useSettings((s) => s.explicitFilter);
  const covers = useQuery({ queryKey: ["explore"], queryFn: api.explore, staleTime: 6 * 60 * 60_000 });
  const home = useQuery({ queryKey: ["home", region], queryFn: () => api.home(region), staleTime: 5 * 60_000 });
  const trending = (home.data?.trending ?? []).filter((t) => !ef || !t.explicit);
  const moods = MOODS.filter((m) => m.kind === "mood");
  const genres = MOODS.filter((m) => m.kind === "genre");

  return (
    <div className="fade-up">
      <PageTitle>Explore</PageTitle>

      {(home.data?.newReleases?.length ?? 0) > 0 && (
        <section className="mb-9">
          <SectionHeader title="New releases" />
          <Shelf>
            {home.data!.newReleases.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </section>
      )}

      {trending.length > 0 ? (
        <section className="mb-9">
          <SectionHeader title="Top songs" subtitle="Charts" />
          <QuickPicks tracks={trending.slice(0, 20)} label="Top songs" />
        </section>
      ) : home.isLoading ? (
        <div className="mb-9 px-4 desk:px-8">
          <Skeleton className="mb-3 h-6 w-40 rounded-md" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[52px] w-full max-w-[400px] rounded-[8px]" />
            ))}
          </div>
        </div>
      ) : null}

      <section className="mb-9">
        <SectionHeader title="Moods & moments" />
        <Grid>
          {moods.map((m) => (
            <MoodCard key={m.slug} title={m.title} color={m.color} artwork={covers.data?.covers[m.slug]} href={`/explore/${m.slug}`} />
          ))}
        </Grid>
      </section>

      <section className="mb-9">
        <SectionHeader title="Genres" />
        <Grid>
          {genres.map((m) => (
            <MoodCard key={m.slug} title={m.title} color={m.color} artwork={covers.data?.covers[m.slug]} href={`/explore/${m.slug}`} />
          ))}
        </Grid>
      </section>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 2xl:grid-cols-5 [@media(min-width:1700px)]:grid-cols-6">
      {children}
    </div>
  );
}
