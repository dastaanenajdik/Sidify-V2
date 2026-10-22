"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info, SearchX, X } from "lucide-react";
import { useMediaBrowse } from "@/lib/media/hooks";
import { SORTS } from "@/lib/media/query";
import type { MediaKind, MediaSort, MediaTitle } from "@/lib/media/types";
import { Button, EmptyState, PageTitle, SectionHeader, Shelf, Skeleton } from "@/components/ui";
import { cx } from "@/lib/format";
import { MediaFilterBar, type MediaFilterValue } from "./MediaFilterBar";
import { MediaHero } from "./MediaHero";
import { PosterCard, posterShelfClass } from "./PosterCard";

/**
 * Shared browse experience for /movies and /series.
 *
 * Filters live in the URL (`?q=&genre=&year=&language=&sort=`) so a filtered view can be
 * shared or reloaded, and the query key follows them so React Query caches each view.
 */
export default function MediaBrowsePage({ kind }: { kind: MediaKind }) {
  return (
    <Suspense fallback={<BrowseSkeleton />}>
      <Browse kind={kind} />
    </Suspense>
  );
}

function Browse({ kind }: { kind: MediaKind }) {
  const router = useRouter();
  const pathname = usePathname() || (kind === "movie" ? "/movies" : "/series");
  const params = useSearchParams();

  const qParam = params.get("q") ?? "";
  const sortParam = params.get("sort") ?? "";
  const sort = (SORTS.some((s) => s.id === sortParam) ? sortParam : "trending") as MediaSort;
  const value: MediaFilterValue = {
    q: qParam,
    genre: params.get("genre") ?? "",
    year: params.get("year") ?? "",
    language: params.get("language") ?? "",
    sort,
  };

  /** The field keeps its own draft so typing never waits on the URL round-trip. */
  const [draft, setDraft] = useState(qParam);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(qParam);
  }, [qParam]);
  useEffect(() => {
    if (!editing.current) return;
    const timer = setTimeout(() => {
      editing.current = false;
      setParams({ q: draft });
    }, 320);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const [noticeHidden, setNoticeHidden] = useState(false);

  const query = useMediaBrowse(kind, value);
  const pages = query.data?.pages;
  const first = pages?.[0];

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: MediaTitle[] = [];
    for (const page of pages ?? []) {
      for (const item of page.items) {
        const key = `${item.kind}:${item.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }, [pages]);

  function setParams(patch: Partial<Record<keyof MediaFilterValue, string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (!val || (key === "sort" && val === "trending")) next.delete(key);
      else next.set(key, val);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const clearFilters = () => {
    editing.current = false;
    setDraft("");
    router.replace(pathname, { scroll: false });
  };

  const noun = kind === "movie" ? "movie" : "series";
  const railTitle = kind === "movie" ? "All movies" : "All series";
  const demo = first?.provider.demo;
  const loading = query.isPending;
  const errored = query.isError;

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          <div className="flex items-center gap-1.5 rounded-full bg-fill p-1" role="group" aria-label="Browse movies or series">
            <KindLink href="/movies" active={kind === "movie"}>
              Movies
            </KindLink>
            <KindLink href="/series" active={kind === "series"}>
              Series
            </KindLink>
          </div>
        }
      >
        {kind === "movie" ? "Movies" : "Series"}
      </PageTitle>

      {demo && !noticeHidden && !loading && (
        <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-[12px] bg-raised/80 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2 desk:mx-8">
          <Info size={15} className="mt-[1px] shrink-0 text-fg-2" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold text-fg">Demo catalogue.</span> These are placeholder titles used while no catalogue
            provider could answer. Set{" "}
            <code className="rounded bg-fill px-1 py-[1px] text-[11.5px]">MEDIA_PROVIDER=archive</code> for free public-domain
            films, or add <code className="rounded bg-fill px-1 py-[1px] text-[11.5px]">TMDB_API_KEY</code> for licensed metadata
            plus official availability lookups.
          </p>
          <button
            type="button"
            aria-label="Dismiss demo notice"
            onClick={() => setNoticeHidden(true)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {!value.q && !value.genre && !value.year && !value.language && value.sort === "trending" && first?.featured && (
        <MediaHero title={first.featured} />
      )}

      <div className="mt-1 mb-6">
        <MediaFilterBar
          value={{ ...value, q: draft }}
          facets={first?.facets}
          busy={query.isFetching && !loading}
          onChange={setParams}
          onQuery={(q) => {
            editing.current = true;
            setDraft(q);
          }}
          onClear={clearFilters}
        />
      </div>

      {loading ? (
        <GridSkeleton />
      ) : errored ? (
        <EmptyState
          title="Couldn't load the catalogue"
          desc="The provider didn't answer. Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<SearchX size={26} />}
          title={`No ${noun === "movie" ? "movies" : "series"} match`}
          desc="Try a different search, or loosen the filters."
          action={
            <Button variant="secondary" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {first?.rails?.map((rail) => (
            <section key={rail.id} className="mb-8">
              <SectionHeader title={rail.title} subtitle={rail.subtitle} />
              <Shelf>
                {rail.items.map((item) => (
                  <PosterCard key={`${rail.id}-${item.kind}-${item.id}`} title={item} className={posterShelfClass} />
                ))}
              </Shelf>
            </section>
          ))}

          <section aria-label={railTitle}>
            <SectionHeader
              title={railTitle}
              subtitle={
                first
                  ? `${first.totalResults.toLocaleString()} ${first.totalResults === 1 ? noun : `${noun === "series" ? "series" : "movies"}`}`
                  : undefined
              }
            />
            <MediaGrid>
              {items.map((item, index) => (
                <PosterCard key={`${item.kind}-${item.id}`} title={item} eager={index < 6} />
              ))}
            </MediaGrid>

            {query.hasNextPage && (
              <div className="mt-7 flex justify-center">
                <Button variant="secondary" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </section>

          {first?.provider.attribution && !first.provider.demo && (
            <p className="px-4 pt-8 text-[11.5px] leading-relaxed text-fg-3 desk:px-8">{first.provider.attribution}</p>
          )}
        </>
      )}
    </div>
  );
}

function KindLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
        active ? "bg-primary text-on-primary" : "text-fg-2 hover:bg-fill-2 hover:text-fg"
      )}
    >
      {children}
    </Link>
  );
}

export function MediaGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-7 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 [@media(min-width:1700px)]:grid-cols-7">
      {children}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-7 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[2/3] w-full rounded-[10px]" />
          <Skeleton className="mt-2 h-3.5 w-3/4 rounded" />
          <Skeleton className="mt-1.5 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

function BrowseSkeleton() {
  return (
    <div>
      <div className="px-4 pt-2 pb-4 desk:px-8 desk:pt-7">
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <Skeleton className="mx-0 h-[380px] w-full rounded-none" />
      <div className="mt-6">
        <GridSkeleton />
      </div>
    </div>
  );
}
