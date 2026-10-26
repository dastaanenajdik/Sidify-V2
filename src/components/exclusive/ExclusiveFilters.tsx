"use client";

import { SlidersHorizontal, X } from "lucide-react";
import type { MediaFacets, MediaKind, MediaSort, MediaTitle } from "@/lib/media/types";
import { cx } from "@/lib/format";
import { popularGenres } from "@/lib/media/recommend";
import type { ExclusiveFiltersValue } from "./types";

const KINDS: { id: MediaKind | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "Series" },
];

export const EXCLUSIVE_SORTS: { id: MediaSort; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "rating", label: "Top rated" },
  { id: "title", label: "A–Z" },
];

/**
 * The collection's filter bar.
 *
 * Genre choices are ordered by how many titles they actually hold, so the bar
 * never offers a genre the collection cannot fill. Every control maps to one
 * URL-independent state value (`ExclusiveFiltersValue`), which the section
 * turns into the API query.
 */
export function ExclusiveFilters({
  value,
  facets,
  pool,
  onChange,
  onClear,
}: {
  value: ExclusiveFiltersValue;
  facets: MediaFacets;
  /** Titles the genre order is derived from (usually the landing payload). */
  pool: readonly MediaTitle[];
  onChange: (patch: Partial<ExclusiveFiltersValue>) => void;
  onClear: () => void;
}) {
  const ranking = popularGenres(pool, 1, 16);
  const genres = (ranking.length ? ranking : facets.genres).slice(0, 14);
  const active = Boolean(value.genre || value.year || value.language || value.sort !== "trending" || value.kind !== "all");

  return (
    <section aria-label="Filter the exclusive collection" className="mt-5 mb-7 space-y-2.5 px-4 desk:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-fill p-1" role="group" aria-label="Movies, series or everything">
          {KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={value.kind === entry.id}
              onClick={() => onChange({ kind: entry.id, page: 1 })}
              className={cx(
                "h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                value.kind === entry.id ? "bg-primary text-on-primary" : "text-fg-2 hover:text-fg"
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="exclusive-sort">
            Sort the exclusive collection
          </label>
          <div className="relative">
            <SlidersHorizontal
              size={13}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-3"
            />
            <select
              id="exclusive-sort"
              value={value.sort}
              onChange={(event) => onChange({ sort: event.target.value as MediaSort, page: 1 })}
              className="h-8 appearance-none rounded-full bg-fill pr-7 pl-7 text-[12.5px] font-semibold text-fg outline-none focus:ring-2 focus:ring-primary/50"
            >
              {EXCLUSIVE_SORTS.map((sort) => (
                <option key={sort.id} value={sort.id}>
                  {sort.label}
                </option>
              ))}
            </select>
          </div>

          <label className="sr-only" htmlFor="exclusive-year">
            Filter by year
          </label>
          <select
            id="exclusive-year"
            value={value.year ?? ""}
            onChange={(event) => onChange({ year: event.target.value || undefined, page: 1 })}
            className="h-8 appearance-none rounded-full bg-fill px-3 text-[12.5px] font-semibold text-fg outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Any year</option>
            {facets.years.slice(0, 40).map((year) => (
              <option key={String(year)} value={String(year)}>
                {year}
              </option>
            ))}
          </select>

          {facets.languages.length > 1 && (
            <>
              <label className="sr-only" htmlFor="exclusive-language">
                Filter by language
              </label>
              <select
                id="exclusive-language"
                value={value.language ?? ""}
                onChange={(event) => onChange({ language: event.target.value || undefined, page: 1 })}
                className="hidden h-8 appearance-none rounded-full bg-fill px-3 text-[12.5px] font-semibold text-fg outline-none focus:ring-2 focus:ring-primary/50 sm:block"
              >
                <option value="">Any language</option>
                {facets.languages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {active && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold text-fg-2 hover:bg-fill hover:text-fg"
            >
              <X size={13} aria-hidden="true" />
              Clear
            </button>
          )}
        </div>
      </div>

      {genres.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar desk:-mx-8 desk:px-8">
          <GenreChip active={!value.genre} onClick={() => onChange({ genre: undefined, page: 1 })}>
            All genres
          </GenreChip>
          {genres.map((genre) => (
            <GenreChip
              key={genre.id}
              active={value.genre === genre.id}
              onClick={() => onChange({ genre: value.genre === genre.id ? undefined : genre.id, page: 1 })}
            >
              {genre.name}
            </GenreChip>
          ))}
        </div>
      )}
    </section>
  );
}

function GenreChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors",
        active ? "bg-primary text-on-primary" : "bg-fill text-fg-2 hover:bg-fill-2 hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}
