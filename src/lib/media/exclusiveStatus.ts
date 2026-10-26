/**
 * Which transport answered the exclusive collection, and how it went.
 *
 * The UI needs this for one honest sentence: "this is a saved copy from 2
 * hours ago" is a very different message from "this is live". Keeping it in a
 * tiny observable store (instead of inside React Query's data) means the
 * payload types stay exactly what the API returns, and any component can read
 * the transport without prop-drilling.
 *
 * `useSyncExternalStore`-compatible: `subscribe` + `getSnapshot` return a
 * stable object identity until something actually changes.
 */

export type ExclusiveTransport = "direct" | "relay" | "snapshot";

/**
 * Why the stream list for the title on screen could not be resolved.
 *
 * Playback is the one part of a title read that the catalogue guards hardest
 * (the old server route answered `440` — its own "session rejected" code), so
 * "no play button" has several distinguishable causes. Naming them lets the
 * page say something true instead of a generic "no stream".
 */
export type ExclusiveStreamIssue =
  | "cors_or_network"
  | "ticket_unavailable"
  | "session_rejected"
  | "refused"
  | "upstream_error"
  | "empty";

export interface ExclusiveStatusSnapshot {
  /** Which path produced the most recent successful payload. */
  transport: ExclusiveTransport | null;
  /** When a snapshot was written (ms epoch) — only for `transport: "snapshot"`. */
  cachedAt: number | null;
  /** A short, log-safe reason the direct path was not used. */
  directFallbackReason: string | null;
  /** Whether the browser path has been proven to work in this session. */
  directAvailable: boolean;
  /** When the last attempt finished (ms epoch). */
  updatedAt: number;
  /** The last transport error, for the console — never rendered raw. */
  lastError: string | null;
  /** Why the last title read produced no playable source, if it did not. */
  streamIssue: ExclusiveStreamIssue | null;
  /** The upstream status behind `streamIssue`, when there was one. */
  streamIssueStatus: number | null;
}

const INITIAL: ExclusiveStatusSnapshot = {
  transport: null,
  cachedAt: null,
  directFallbackReason: null,
  directAvailable: false,
  updatedAt: 0,
  lastError: null,
  streamIssue: null,
  streamIssueStatus: null,
};

let current: ExclusiveStatusSnapshot = INITIAL;
const listeners = new Set<() => void>();

function publish(next: Partial<ExclusiveStatusSnapshot>): void {
  const merged: ExclusiveStatusSnapshot = { ...current, ...next, updatedAt: Date.now() };
  if (
    merged.transport === current.transport &&
    merged.cachedAt === current.cachedAt &&
    merged.directFallbackReason === current.directFallbackReason &&
    merged.directAvailable === current.directAvailable &&
    merged.lastError === current.lastError &&
    merged.streamIssue === current.streamIssue &&
    merged.streamIssueStatus === current.streamIssueStatus
  ) {
    return;
  }
  current = merged;
  for (const listener of listeners) listener();
}

export const exclusiveStatus = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ExclusiveStatusSnapshot {
    return current;
  },
  /** Server render / first client render: no transport has run yet. */
  getServerSnapshot(): ExclusiveStatusSnapshot {
    return INITIAL;
  },
  noteSuccess(transport: ExclusiveTransport, cachedAt: number | null = null): void {
    publish({
      transport,
      cachedAt,
      lastError: null,
      directAvailable: transport === "direct" ? true : current.directAvailable,
      directFallbackReason: transport === "direct" ? null : current.directFallbackReason,
    });
  },
  noteDirectFallback(reason: string): void {
    publish({ directAvailable: false, directFallbackReason: reason });
  },
  noteError(message: string): void {
    publish({ lastError: message, transport: null, cachedAt: null });
  },
  /**
   * Records why a title resolved without a playable source.
   *
   * Deliberately separate from `noteError`: the *title* loaded fine (poster,
   * synopsis, downloads), so this must not blank the transport badge — it only
   * feeds the sentence shown where the player would be.
   */
  noteStreamIssue(issue: ExclusiveStreamIssue, status: number | null = null): void {
    publish({ streamIssue: issue, streamIssueStatus: status });
  },
  clearStreamIssue(): void {
    if (current.streamIssue === null && current.streamIssueStatus === null) return;
    publish({ streamIssue: null, streamIssueStatus: null });
  },
  reset(): void {
    current = INITIAL;
    for (const listener of listeners) listener();
  },
};

/** One plain sentence for a stream issue — safe to render, never raw upstream text. */
export function streamIssueSentence(
  issue: ExclusiveStreamIssue | null,
  status: number | null = null
): string | null {
  switch (issue) {
    case "cors_or_network":
      return "This browser could not reach the catalogue — the request was refused before it arrived.";
    case "ticket_unavailable":
      return "Stream requests could not be signed just now.";
    case "session_rejected":
      return `The catalogue rejected this session${status ? ` (${status})` : ""} — reloading usually issues a fresh one.`;
    case "refused":
      return `The catalogue refused the stream list for this title${status ? ` (${status})` : ""}.`;
    case "upstream_error":
      return `The catalogue could not serve the stream list${status ? ` (${status})` : ""}.`;
    case "empty":
      return "The catalogue answered, but listed no playable stream for this title.";
    default:
      return null;
  }
}
