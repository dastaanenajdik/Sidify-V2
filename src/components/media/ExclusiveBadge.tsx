"use client";

import { cx } from "@/lib/format";

/**
 * A minimal mark for titles that come from the exclusive collection.
 *
 * Deliberately generic — a small geometric glyph plus the word "Exclusive" — so no
 * upstream product name appears anywhere on the site.
 */
export function ExclusiveBadge({
  className,
  compact = false,
}: {
  className?: string;
  /** `compact` drops the word and keeps the glyph only (used on small posters). */
  compact?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full bg-black/70 font-bold tracking-[0.08em] text-white uppercase backdrop-blur-md",
        compact ? "px-1.5 py-[2px] text-[9px]" : "px-2 py-[3px] text-[9.5px]",
        className
      )}
      title="Exclusive collection"
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M5 0.6 6.5 3.5 9.7 3.5 7.35 5.55 8.15 8.75 5 6.9 1.85 8.75 2.65 5.55 0.3 3.5 3.5 3.5Z" fill="currentColor" />
      </svg>
      {!compact && <span>Exclusive</span>}
      {compact && <span className="sr-only">Exclusive</span>}
    </span>
  );
}
