"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { useExclusiveSearch } from "@/lib/media/hooks";
import type { MediaTitle } from "@/lib/media/types";
import { Button, EmptyState, PageTitle, SectionHeader, Shelf, Skeleton } from "@/components/ui";
import { cx } from "@/lib/format";
import { MediaGrid } from "./MediaBrowsePage";
import { PosterCard, posterShelfClass } from "./PosterCard";

/**
 * The exclusive collection.
 *
 * Its own section with its own search box: only this catalogue's titles appear here,
 * never the main catalogue's. Every result is a normal title, so its detail page,
 * player and downloads work exactly as they do elsewhere.
 */
export function ExclusiveSection() {
  const [term, setTerm] = useState("");
  const [draft, setDraft] = useState("");
  const editing = useRef(false);

  // The field keeps its own draft so typing never waits on the request.
  useEffect(() => {
    if (!editing.current) setDraft(term);
  }, [term]);
  useEffect(() => {
    if (!editing.current) return;
    const timer = setTimeout(() => {
      editing.current = false;
      setTerm(draft.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [draft]);

  const query = useExclusiveSearch(term, true, 30);
  const items: MediaTitle[] = query.data?.items ?? [];
  const loading = query.isPending;
  const errored = query.isError;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    editing.current = false;
    setTerm(draft.trim());
  };

  const clear = () => {
    editing.current = false;
    setDraft("");
    setTerm("");
  };

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[12px] font-semibold text-fg-2">
            <Sparkles size={13} aria-hidden="true" />
            Exclusive collection
          </span>
        }
      >
        Exclusive
      </PageTitle>

      <div className="px-4 desk:px-8">
        <p className="max-w-[680px] text-[13.5px] leading-relaxed text-fg-2">
          A separate collection, searched on its own. Results here come only from this
          source — every one of them opens with its own details, streams and downloads.
        </p>
      </div>

      <form onSubmit={submit} className="mt-4 px-4 desk:px-8" role="search" aria-label="Search the exclusive collection">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3"
            />
            <input
              type="search"
              value={draft}
              onChange={(event) => {
                editing.current = true;
                setDraft(event.target.value);
              }}
              placeholder="Search the exclusive collection…"
              aria-label="Search the exclusive collection"
              className="h-11 w-full rounded-[12px] bg-raised pr-9 pl-9 text-[14px] ring-1 ring-edge outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-primary/60"
            />
            {draft && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clear}
                className="absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <Button type="submit" disabled={loading && !draft}>
            Search
          </Button>
        </div>
      </form>

      {loading ? (
        <div className="mt-8">
          <GridSkeleton />
        </div>
      ) : errored ? (
        <div className="px-4 desk:px-8">
          <EmptyState
            icon={<Sparkles size={26} />}
            title="The exclusive collection is unavailable"
            desc="It could not be reached right now. Please try again in a moment."
            action={
              <Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? "Retrying…" : "Try again"}
              </Button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 desk:px-8">
          <EmptyState
            icon={<Search size={26} />}
            title={term ? "No matches in the exclusive collection" : "Nothing here yet"}
            desc={
              term
                ? `Nothing in this collection matches “${term}”. Try a different title.`
                : "This collection is empty right now. Please try again shortly."
            }
            action={term ? <Button variant="secondary" onClick={clear}>Clear search</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <section className="mt-8 mb-8">
            <SectionHeader
              title={term ? `Results for “${term}”` : "Popular in the collection"}
              subtitle={`${items.length} ${items.length === 1 ? "title" : "titles"}`}
            />
            <Shelf>
              {items.slice(0, 12).map((item) => (
                <PosterCard key={`${item.kind}-${item.id}`} title={item} className={posterShelfClass} />
              ))}
            </Shelf>
          </section>

          {items.length > 12 && (
            <section aria-label="All exclusive titles" className="mt-2">
              <SectionHeader title="All titles" />
              <MediaGrid>
                {items.map((item, index) => (
                  <PosterCard key={`grid-${item.kind}-${item.id}`} title={item} eager={index < 6} className="cv-card" />
                ))}
              </MediaGrid>
            </section>
          )}
        </>
      )}
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
