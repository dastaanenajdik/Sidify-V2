"use client";

import { useSyncExternalStore } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { exclusiveStatus } from "@/lib/media/exclusiveStatus";

/** "2 minutes ago" / "3 hours ago" — short and absolute enough to trust. */
export function relativeAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The internal fallback code → a sentence a person can act on. */
function plainReason(reason: string): string {
  if (reason === "cors_or_network") return "it does not allow direct browser requests";
  if (reason === "timeout") return "the direct request timed out";
  if (reason === "ticket empty" || reason === "ticket 503") return "signing is unavailable right now";
  return "the direct request could not be made";
}

/**
 * One line under the section header that says where the data came from.
 *
 * It is deliberately quiet (a pill, not a modal) and only appears when it has
 * something useful to say:
 *
 *   - **direct**  → nothing. Fetching from the user's own connection is the
 *                   normal path; a badge for it would be noise.
 *   - **relay**   → nothing either, unless the browser path was blocked, in
 *                   which case the hint explains *why* (and that it is not a
 *                   bug the user can fix).
 *   - **snapshot**→ "Saved copy — 2 hours ago" with a Retry, because the user is
 *                   looking at stale data and deserves to know.
 */
export function ExclusiveStatusBanner({ onRetry, retrying }: { onRetry?: () => void; retrying?: boolean }) {
  const status = useSyncExternalStore(
    exclusiveStatus.subscribe,
    exclusiveStatus.getSnapshot,
    exclusiveStatus.getServerSnapshot
  );

  if (status.transport === "snapshot" && status.cachedAt) {
    return (
      <div
        role="status"
        className="mx-4 mb-4 flex flex-wrap items-center gap-2 rounded-[10px] bg-fill px-3 py-2 text-[12.5px] text-fg-2 desk:mx-8"
      >
        <CloudOff size={14} aria-hidden="true" className="shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1">
          Showing a saved copy from <strong className="font-semibold text-fg">{relativeAge(status.cachedAt)}</strong> —
          the collection could not be reached just now.
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-full bg-raise px-2.5 py-1 text-[12px] font-semibold text-fg hover:bg-fill-2 disabled:opacity-60"
          >
            <RefreshCw size={12} className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
            {retrying ? "Retrying…" : "Retry"}
          </button>
        )}
      </div>
    );
  }

  if (status.transport === "relay" && status.directFallbackReason) {
    return (
      <div className="mx-4 mb-4 flex items-start gap-2 rounded-[10px] bg-fill px-3 py-2 text-[12px] leading-relaxed text-fg-3 desk:mx-8">
        <Wifi size={13} aria-hidden="true" className="mt-[2px] shrink-0" />
        <span>
          Loaded through Sidify&apos;s servers — {plainReason(status.directFallbackReason)}. Live data still works; it is
          only a little slower.
        </span>
      </div>
    );
  }

  return null;
}
