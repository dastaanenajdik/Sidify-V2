"use client";

import { ChevronDown, X } from "lucide-react";
import { Chips } from "@/components/ui";
import { SearchGlyph } from "@/components/icons";
import { SORTS } from "@/lib/media/query";
import type { MediaFacets, MediaSort } from "@/lib/media/types";
import { cx } from "@/lib/format";

export interface MediaFilterValue {
  q: string;
  genre: string;
  year: string;
  language: string;
  sort: MediaSort;
}

/**
 * Search + genre / year / language / sort filters. Chips for genres (fast to scan),
 * native selects for the longer lists — keyboard and screen-reader friendly by default.
 */
export function MediaFilterBar({
  value,
  facets,
  onChange,
  onQuery,
  onClear,
  busy,
}: {
  value: MediaFilterValue;
  facets?: MediaFacets;
  onChange: (patch: Partial<MediaFilterValue>) => void;
  onQuery: (q: string) => void;
  onClear: () => void;
  busy?: boolean;
}) {
  const active = Boolean(value.q || value.genre || value.year || value.language) || value.sort !== "trending";
  const genreOptions = [{ id: "all", label: "All genres" }, ...(facets?.genres ?? []).map((g) => ({ id: g.id, label: g.name }))];

  return (
    <div className="px-4 desk:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <SearchGlyph
            size={15}
            className={cx("pointer-events-none absolute top-1/2 left-3 -translate-y-1/2", busy ? "text-fg" : "text-fg-2")}
          />
          <input
            value={value.q}
            onChange={(e) => onQuery(e.target.value)}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search movies and series"
            aria-label="Search movies and series"
            className="field h-10 w-full rounded-[10px] pr-9 pl-9 text-[16px] desk:text-[14px]"
          />
          {value.q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onQuery("")}
              className="absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-fill-3 text-fg-2"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <Select label="Year" value={value.year} onChange={(year) => onChange({ year })}>
          <option value="">Any year</option>
          {(facets?.years ?? []).map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>

        <Select label="Language" value={value.language} onChange={(language) => onChange({ language })}>
          <option value="">Any language</option>
          {(facets?.languages ?? []).map((language) => (
            <option key={language.code} value={language.code}>
              {language.name}
            </option>
          ))}
        </Select>

        <Select label="Sort by" value={value.sort} onChange={(sort) => onChange({ sort: sort as MediaSort })}>
          {SORTS.map((sort) => (
            <option key={sort.id} value={sort.id}>
              {sort.label}
            </option>
          ))}
        </Select>

        {active && (
          <button
            type="button"
            onClick={onClear}
            className="h-10 shrink-0 rounded-full px-3 text-[13px] font-semibold text-playing hover:bg-fill"
          >
            Clear filters
          </button>
        )}
      </div>

      <Chips
        className="mt-3 pb-1"
        value={value.genre || "all"}
        options={genreOptions}
        onChange={(genre) => onChange({ genre: genre === "all" ? "" : genre })}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <label className="sr-only" htmlFor={`media-filter-${label}`}>
        {label}
      </label>
      <select
        id={`media-filter-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="field h-10 appearance-none rounded-[10px] pr-8 text-[13.5px] font-medium"
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-2" aria-hidden="true" />
    </div>
  );
}
