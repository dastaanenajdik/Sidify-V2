"use client";

import type { ExclusiveRail as ExclusiveRailModel, MediaTitle } from "@/lib/media/types";
import { SectionHeader, Shelf } from "@/components/ui";
import { ExclusivePoster, exclusiveShelfClass } from "./ExclusivePoster";

/**
 * One horizontal shelf of the exclusive collection.
 *
 * The rail's `layout` only changes presentation: a `ranked` rail numbers its
 * cards (Top 10), everything else is a plain poster shelf. Empty rails are not
 * rendered at all — a heading with no titles under it reads as a bug.
 */
export function ExclusiveRail({
  rail,
  onPlay,
}: {
  rail: ExclusiveRailModel;
  onPlay?: (title: MediaTitle) => void;
}) {
  if (!rail.items.length) return null;
  const ranked = rail.layout === "ranked";

  return (
    <section aria-label={rail.title} className="mb-8">
      <SectionHeader
        title={rail.title}
        subtitle={rail.subtitle}
        trailing={
          <span className="text-[12px] font-medium text-fg-3 tabular-nums">
            {rail.items.length} {rail.items.length === 1 ? "title" : "titles"}
          </span>
        }
      />
      <Shelf gap={ranked ? 16 : 14}>
        {rail.items.map((item, index) => (
          <ExclusivePoster
            key={`${rail.id}-${item.kind}-${item.slug}`}
            title={item}
            rank={ranked ? index + 1 : undefined}
            eager={index < 5}
            onPlay={onPlay}
            className={exclusiveShelfClass}
          />
        ))}
      </Shelf>
    </section>
  );
}
