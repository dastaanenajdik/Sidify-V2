"use client";

import { ExternalLink } from "lucide-react";
import { Sheet } from "@/components/ui";
import type { TrailerRef } from "@/lib/media/types";

/**
 * Official trailer, embedded from YouTube (privacy-enhanced domain) with a link back to
 * the rights holder's own video. Only keys supplied by the provider are ever embedded.
 */
export function TrailerSheet({
  open,
  onClose,
  trailer,
  title,
}: {
  open: boolean;
  onClose: () => void;
  trailer: TrailerRef | null | undefined;
  title: string;
}) {
  const watchUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;

  return (
    <Sheet open={open} onClose={onClose} title={`${title} — trailer`} subtitle="Official trailer" width={820} footer={
      watchUrl ? (
        <a
          href={watchUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-playing hover:opacity-80"
        >
          Watch on YouTube <ExternalLink size={13} aria-hidden="true" />
        </a>
      ) : undefined
    }>
      {trailer ? (
        <div className="space-y-3">
          <div className="aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-edge">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?rel=0&modestbranding=1`}
              title={`${title} — ${trailer.name}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-full w-full border-0"
            />
          </div>
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            {trailer.name}. Trailer streamed from the rights holder&apos;s official YouTube channel.
          </p>
        </div>
      ) : (
        <p className="py-6 text-center text-[14px] text-fg-2">No official trailer is available for this title.</p>
      )}
    </Sheet>
  );
}
