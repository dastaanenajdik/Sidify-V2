"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useExclusiveHome, useExclusiveSearch, useExclusiveSuggestions } from "@/lib/media/hooks";
import { dedupeTitles } from "@/lib/media/recommend";
import type { MediaFacets, MediaKind, MediaTitle } from "@/lib/media/types";
import { EMPTY_FACETS } from "@/lib/media/recommend";
import { Button, EmptyState, PageTitle, SectionHeader, Skeleton } from "@/components/ui";
import { cx } from "@/lib/format";
import { ExclusiveFilters } from "@/components/exclusive/ExclusiveFilters";
import { ExclusiveHero } from "@/components/exclusive/ExclusiveHero";
import { ExclusivePlayerSheet } from "@/components/exclusive/ExclusivePlayerSheet";
import { ExclusiveStatusBanner } from "@/components/exclusive/ExclusiveStatusBanner";
import { ExclusivePoster } from "@/components/exclusive/ExclusivePoster";
import { ExclusiveRail } from "@/components/exclusive/ExclusiveRail";
import { EMPTY_EXCLUSIVE_FILTERS, hasActiveFilters, type ExclusiveFiltersValue } from "@/components/exclusive/types";
import { useWatchlist } from "@/store/watchlist";

/**
 * The exclusive collection.
 *
 * One catalogue, one section, its own search. Three states share the page:
 *
 *   - **Landing** (nothing typed, no filters): a spotlight plus the collection's
 *     own rails — trending, top 10, new releases, films, series, acclaimed,
 *     classics. This is `.mode = "home"` from `/api/media/exclusive`.
 *   - **Results** (a term, genre, year, language, kind or sort is set): a
 *     filtered, sorted, paginated grid with the same facets.
 *   - **Player**: an in-page Shaka Player sheet with quality, audio track and
 *     subtitle selection.
 *
 * The section never mixes in the main catalogue: every request goes to the
 * exclusive endpoints, and every card links to the title's own detail page.
 */
export function ExclusiveSection() {
  const [filters, setFilters] = useState<ExclusiveFiltersValue>(EMPTY_EXCLUSIVE_FILTERS);
  const [draft, setDraft] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [player, setPlayer] = useState<{ slug: string; kind?: MediaKind; title?: string } | null>(null);
  const editing = useRef(false);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  // The field keeps its own draft so typing never waits on the request.
  useEffect(() => {
    if (!editing.current) setDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (!editing.current) return;
    const timer = setTimeout(() => {
      editing.current = false;
      setFilters((current) => ({ ...current, q: draft.trim(), page: 1 }));
    }, 350);
    return () => clearTimeout(timer);
  }, [draft]);

  // Clicking anywhere else closes the suggestion list.
  useEffect(() => {
    if (!suggestOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (suggestionsRef.current?.contains(event.target as Node)) return;
      setSuggestOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [suggestOpen]);

  const active = hasActiveFilters(filters);
  const home = useExclusiveHome();
  const search = useExclusiveSearch(filters, active);
  const suggestions = useExclusiveSuggestions(draft, suggestOpen);

  const homePool = useMemo<MediaTitle[]>(
    () => dedupeTitles((home.data?.rails ?? []).flatMap((rail) => rail.items)),
    [home.data?.rails]
  );

  const setPartial = (patch: Partial<ExclusiveFiltersValue>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const clearAll = () => {
    editing.current = false;
    setDraft("");
    setSuggestOpen(false);
    setFilters({ ...EMPTY_EXCLUSIVE_FILTERS });
  };

  const openPlayer = (title: MediaTitle) => setPlayer({ slug: title.slug, kind: title.kind, title: title.title });

  const surprise = () => {
    if (!homePool.length) return;
    const pick = homePool[Math.floor(Math.random() * homePool.length)];
    openPlayer(pick);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    editing.current = false;
    setSuggestOpen(false);
    setFilters((current) => ({ ...current, q: draft.trim(), page: 1 }));
  };

  const facets: MediaFacets = home.data?.facets ?? search.data?.facets ?? EMPTY_FACETS;
  const spotlight = home.data?.spotlight ?? null;
  const saved = useWatchlist((state) => (spotlight ? Boolean(state.savedMap[`${spotlight.kind}:${spotlight.slug}`]) : false));
  const toggleSave = useWatchlist((state) => state.toggle);

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-[12px] font-semibold text-fg-2">
            <Sparkles size={13} aria-hidden="true" />
            {home.data?.total ? `${home.data.total} titles` : "Exclusive collection"}
          </span>
        }
      >
        Exclusive
      </PageTitle>

      {home.isPending ? (
        <HeroSkeleton />
      ) : home.isError || !spotlight ? (
        <div className="px-4 desk:px-8">
          <EmptyState
            icon={<Sparkles size={26} />}
            title="The exclusive collection is unavailable"
            desc="It could not be reached just now — this is a network or catalogue hiccup, not you. Everything else in Sidify keeps working."
            action={
              <Button variant="secondary" onClick={() => void home.refetch()} disabled={home.isFetching}>
                <RefreshCw size={14} className={home.isFetching ? "animate-spin" : undefined} aria-hidden="true" />
                {home.isFetching ? "Retrying…" : "Retry"}
              </Button>
            }
          />
        </div>
      ) : (
        <ExclusiveHero
          title={spotlight}
          onPlay={openPlayer}
          onSurprise={homePool.length > 1 ? surprise : undefined}
          saved={saved}
          onToggleSave={(title) => toggleSave(title)}
        />
      )}

      <form onSubmit={submit} className="mt-5 px-4 desk:px-8" role="search" aria-label="Search the exclusive collection">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-3" />
            <input
              type="search"
              value={draft}
              onChange={(event) => {
                editing.current = true;
                setDraft(event.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              placeholder="Search the exclusive collection…"
              aria-label="Search the exclusive collection"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="exclusive-suggestions"
              aria-expanded={suggestOpen && Boolean(suggestions.data?.items.length)}
              className="h-11 w-full rounded-[12px] bg-raised pr-9 pl-9 text-[14px] ring-1 ring-edge outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-primary/60"
            />
            {draft && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  editing.current = false;
                  setDraft("");
                  setSuggestOpen(false);
                  setPartial({ q: "", page: 1 });
                }}
                className="absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-fg-2 hover:bg-fill-2 hover:text-fg"
              >
                <X size={14} />
              </button>
            )}

            {suggestOpen && draft.trim().length >= 2 && (
              <div
                ref={suggestionsRef}
                id="exclusive-suggestions"
                role="listbox"
                aria-label="Suggestions"
                className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[12px] bg-raised p-1.5 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85)] ring-1 ring-edge"
              >
                {suggestions.isPending ? (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-fg-3">
                    <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
                    Searching the collection…
                  </div>
                ) : suggestions.data?.items.length ? (
                  suggestions.data.items.map((item) => (
                    <Link
                      key={`${item.kind}-${item.slug}`}
                      href={`/${item.kind === "movie" ? "movies" : "series"}/${encodeURIComponent(item.slug)}`}
                      role="option"
                      aria-selected={false}
                      onClick={() => setSuggestOpen(false)}
                      className="flex items-center gap-2.5 rounded-[9px] px-2 py-1.5 hover:bg-fill-2"
                    >
                      <span className="h-11 w-8 shrink-0 overflow-hidden rounded-[4px] bg-fill ring-1 ring-edge">
                        {item.poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">{item.title}</span>
                        <span className="block truncate text-[11.5px] text-fg-2">
                          {[item.year, item.kind === "series" ? "Series" : "Film", item.genres[0]?.name].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="px-2.5 py-2 text-[12.5px] text-fg-3">No title in this collection matches “{draft.trim()}”.</div>
                )}
              </div>
            )}
          </div>
          <Button type="submit">Search</Button>
        </div>
      </form>

      <ExclusiveStatusBanner onRetry={() => void home.refetch()} retrying={home.isFetching} />

      <ExclusiveFilters
        value={filters}
        facets={facets}
        pool={homePool.length ? homePool : search.data?.items ?? []}
        onChange={(patch) => setPartial({ ...patch, page: 1 })}
        onClear={clearAll}
      />

      {active ? (
        <section id="exclusive-results" aria-label="Exclusive search results">
          <SectionHeader
            title={
              filters.q
                ? `Results for “${filters.q}”`
                : filters.genre
                  ? `${facets.genres.find((genre) => genre.id === filters.genre)?.name ?? "Filtered"} titles`
                  : "Filtered collection"
            }
            subtitle={
              search.data
                ? `${search.data.totalResults} ${search.data.totalResults === 1 ? "title" : "titles"}`
                : "Searching the collection…"
            }
            trailing={
              search.data && search.data.totalPages > 1 ? (
                <span className="text-[12px] font-medium text-fg-3 tabular-nums">
                  Page {search.data.page} of {search.data.totalPages}
                </span>
              ) : undefined
            }
          />

          {search.isPending ? (
            <ResultsSkeleton />
          ) : search.isError ? (
            <div className="px-4 desk:px-8">
              <EmptyState
                icon={<Search size={26} />}
                title="The search could not be completed"
                desc="The collection did not answer in time. Try again — the rest of Sidify is unaffected."
                action={
                  <Button variant="secondary" onClick={() => void search.refetch()} disabled={search.isFetching}>
                    {search.isFetching ? "Retrying…" : "Try again"}
                  </Button>
                }
              />
            </div>
          ) : !search.data?.items.length ? (
            <div className="px-4 desk:px-8">
              <EmptyState
                icon={<Search size={26} />}
                title={filters.q ? "No matches in the exclusive collection" : "Nothing matches these filters"}
                desc={
                  filters.q
                    ? `Nothing in this collection matches “${filters.q}”. Try another title, or clear the filters.`
                    : "No title in the collection matches this combination. Clear a filter and try again."
                }
                action={
                  <Button variant="secondary" onClick={clearAll}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <ResultGrid items={search.data.items} onPlay={openPlayer} />
              {search.data.totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2 px-4 desk:px-8">
                  <Button
                    variant="secondary"
                    disabled={search.data.page <= 1 || search.isFetching}
                    onClick={() => {
                      setPartial({ page: Math.max(1, filters.page - 1) });
                      document.getElementById("exclusive-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                    Previous
                  </Button>
                  <span className="min-w-[86px] text-center text-[12.5px] font-medium text-fg-2 tabular-nums">
                    {search.data.page} / {search.data.totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={search.data.page >= search.data.totalPages || search.isFetching}
                    onClick={() => {
                      setPartial({ page: Math.min(search.data?.totalPages ?? filters.page, filters.page + 1) });
                      document.getElementById("exclusive-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    Next
                    <ChevronRight size={14} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      ) : home.data ? (
        <div>
          {home.data.rails.map((rail) => (
            <ExclusiveRail key={rail.id} rail={rail} onPlay={openPlayer} />
          ))}
          <p className="px-4 pb-8 text-[12px] text-fg-3 desk:px-8">
            {home.data.total} titles in the exclusive collection · refreshed{" "}
            {new Date(home.data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      ) : null}

      {player && (
        <ExclusivePlayerSheet
          key={player.slug}
          slug={player.slug}
          kind={player.kind}
          fallbackTitle={player.title}
          onClose={() => setPlayer(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------- parts --------------------------------- */

function ResultGrid({ items, onPlay }: { items: MediaTitle[]; onPlay: (title: MediaTitle) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-7 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 [@media(min-width:1700px)]:grid-cols-7">
      {items.map((item, index) => (
        <ExclusivePoster
          key={`${item.kind}-${item.slug}`}
          title={item}
          eager={index < 6}
          onPlay={onPlay}
          className="w-full"
        />
      ))}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="relative min-h-[420px] overflow-hidden desk:min-h-[520px]">
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="relative flex min-h-[420px] flex-col justify-end px-4 pb-8 desk:min-h-[520px] desk:px-8">
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="mt-3 h-12 w-[70%] max-w-[520px] rounded-[10px]" />
        <Skeleton className="mt-3 h-4 w-52 rounded" />
        <Skeleton className="mt-4 h-4 w-full max-w-[560px] rounded" />
        <Skeleton className="mt-2 h-4 w-3/4 max-w-[420px] rounded" />
        <div className="mt-5 flex gap-2">
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className={cx("grid grid-cols-2 gap-x-3.5 gap-y-7 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6")}>
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[2/3] w-full rounded-[12px]" />
          <Skeleton className="mt-2 h-3.5 w-3/4 rounded" />
          <Skeleton className="mt-1.5 h-3 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
