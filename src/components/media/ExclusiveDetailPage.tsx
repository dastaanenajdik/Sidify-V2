"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import MediaDetailView from "@/components/media/MediaDetailView";
import { ExclusiveStatusBanner } from "@/components/exclusive/ExclusiveStatusBanner";
import { Button } from "@/components/ui";
import { useExclusiveTitle } from "@/lib/media/hooks";
import type { MediaKind } from "@/lib/media/types";
import { titleFromVaultSlug, isVaultSlug } from "@/lib/media/vaultAdapt";

/**
 * A film or series page for an **exclusive** title.
 *
 * The rest of the app's detail pages are server components that ask a provider
 * for the payload. That is precisely what fails for this catalogue in
 * production: the provider runs on a serverless function whose datacenter
 * address the upstream refuses, so the page came back "not found" (or 502) even
 * though the title exists.
 *
 * Here the server renders only the frame; the browser fetches the title,
 * its stream list and its download mirrors itself — one signed ticket batch —
 * and paints the same `MediaDetailView` the server path uses. A saved copy from
 * an earlier visit stands in when the network does not cooperate, labelled with
 * its age.
 */
export default function ExclusiveDetailPage({
  slug,
  kind,
  fallbackTitle,
}: {
  slug: string;
  kind: MediaKind;
  fallbackTitle?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const query = useExclusiveTitle(isVaultSlug(slug) ? slug : null, kind);
  const detail = query.data?.detail ?? null;

  if (detail) {
    return (
      <>
        <ExclusiveStatusBanner onRetry={() => void query.refetch()} retrying={query.isFetching} />
        {/* `onRetry` is what turns "no verified stream" into something the
            viewer can act on: the empty player area explains why and re-runs
            the one signed batch that resolves detail + streams + mirrors. */}
        <MediaDetailView detail={detail} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Sparkles size={30} className="text-fg-3" aria-hidden="true" />
        <h1 className="text-[19px] font-bold">{fallbackTitle || "This title"}</h1>
        <p className="text-[13.5px] leading-relaxed text-fg-2">
          It could not be reached just now — a network or catalogue hiccup, not you. The rest of Sidify keeps working,
          and anything you opened before is still saved on this device.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setRetrying(true);
              void query.refetch().finally(() => setRetrying(false));
            }}
            disabled={query.isFetching}
          >
            <RefreshCw size={14} className={retrying || query.isFetching ? "animate-spin" : undefined} aria-hidden="true" />
            {retrying || query.isFetching ? "Retrying…" : "Retry"}
          </Button>
          <Link href="/exclusive" className="text-[13px] font-semibold text-fg-2 underline-offset-2 hover:underline">
            Browse the collection
          </Link>
        </div>
      </div>
    );
  }

  return <DetailSkeleton title={fallbackTitle} />;
}

/** The frame, drawn immediately so the page never flashes white. */
function DetailSkeleton({ title }: { title?: string }) {
  return (
    <div className="animate-pulse px-4 pt-6 desk:px-8" aria-busy="true" aria-label="Loading title">
      <div className="h-[220px] w-full rounded-[18px] bg-fill desk:h-[320px]" />
      <div className="mt-6 flex gap-5">
        <div className="hidden h-[210px] w-[140px] shrink-0 rounded-[12px] bg-fill desk:block" />
        <div className="min-w-0 flex-1 space-y-3">
          {title && <h1 className="text-[20px] font-bold text-fg-2">{title}</h1>}
          <div className="h-4 w-2/3 rounded bg-fill" />
          <div className="h-4 w-1/2 rounded bg-fill" />
          <div className="h-20 w-full rounded bg-fill" />
        </div>
      </div>
    </div>
  );
}
