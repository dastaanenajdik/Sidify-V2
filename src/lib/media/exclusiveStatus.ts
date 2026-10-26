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
}

const INITIAL: ExclusiveStatusSnapshot = {
  transport: null,
  cachedAt: null,
  directFallbackReason: null,
  directAvailable: false,
  updatedAt: 0,
  lastError: null,
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
    merged.lastError === current.lastError
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
  reset(): void {
    current = INITIAL;
    for (const listener of listeners) listener();
  },
};
