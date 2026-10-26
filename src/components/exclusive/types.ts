import type { MediaKind, MediaSort } from "@/lib/media/types";

/**
 * The filter state of the exclusive section.
 *
 * Kept as one flat object so the section can hand it straight to the API
 * (`q`, `kind`, `genre`, `year`, `language`, `sort`, `page`) and use it as a
 * React Query key without translation.
 */
export interface ExclusiveFiltersValue {
  q: string;
  kind: MediaKind | "all";
  genre?: string;
  year?: string;
  language?: string;
  sort: MediaSort;
  page: number;
}

export const EMPTY_EXCLUSIVE_FILTERS: ExclusiveFiltersValue = {
  q: "",
  kind: "all",
  sort: "trending",
  page: 1,
};

/** Whether any filter narrows the collection (so the section shows results, not rails). */
export function hasActiveFilters(value: ExclusiveFiltersValue): boolean {
  return Boolean(value.q.trim() || value.genre || value.year || value.language) || value.kind !== "all" || value.sort !== "trending";
}
