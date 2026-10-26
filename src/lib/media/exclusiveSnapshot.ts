/**
 * Last-known-good payloads for the exclusive collection, kept in the browser.
 *
 * Why this exists: the catalogue is fetched from the *user's* connection
 * (`exclusiveDirect.ts`) or, failing that, from the deployment. Both can fail —
 * a hotel network, a corridor, an upstream outage, a rate limit. When they do,
 * the section must not go blank: it shows the copy it had, labelled with its
 * age, and keeps a Retry button. That is the difference between "a film site
 * with a hiccup" and "a broken tab".
 *
 * Rules:
 *   - **Bounded.** A hard per-entry byte cap and a small entry count, so a
 *     catalogue of 200 titles can never fill the user's storage.
 *   - **Versioned.** A payload shape change bumps `SNAPSHOT_VERSION` and every
 *     old snapshot is ignored (and pruned) instead of being rendered as if it
 *     were current.
 *   - **Failed closed.** Corrupt JSON, a full quota, storage disabled in
 *     private mode: every path returns "no snapshot" rather than throwing.
 */

export const SNAPSHOT_KEY = "sidify-exclusive-snapshot-v1";
/** Bump when a stored payload's shape changes; older entries are dropped. */
export const SNAPSHOT_VERSION = 1;
/** Entries kept; the oldest are evicted first. */
const MAX_ENTRIES = 24;
/** One entry may not exceed this many bytes of JSON. */
const MAX_ENTRY_BYTES = 400_000;
/** The whole store may not exceed this many bytes of JSON. */
const MAX_TOTAL_BYTES = 1_500_000;

export interface SnapshotEntry<T> {
  v: number;
  at: number;
  value: T;
}

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Private-mode Safari has the object but throws on write; a probe is cheaper
    // than catching on every write.
    localStorage.getItem(SNAPSHOT_KEY);
    return localStorage;
  } catch {
    return null;
  }
}

function readStore(storage: StorageLike | null): Record<string, SnapshotEntry<unknown>> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(SNAPSHOT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, SnapshotEntry<unknown>> = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const record = entry as Partial<SnapshotEntry<unknown>> | null;
      if (!record || typeof record !== "object") continue;
      if (record.v !== SNAPSHOT_VERSION) continue;
      if (typeof record.at !== "number" || !Number.isFinite(record.at)) continue;
      out[key] = { v: SNAPSHOT_VERSION, at: record.at, value: record.value };
    }
    return out;
  } catch {
    return {};
  }
}

/** A snapshot for `key`, if one exists and is younger than `maxAgeMs`. */
export function readSnapshot<T>(
  key: string,
  maxAgeMs: number,
  storage: StorageLike | null = defaultStorage(),
  now = Date.now()
): { at: number; value: T } | null {
  const entry = readStore(storage)[key];
  if (!entry) return null;
  const age = now - entry.at;
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
  return { at: entry.at, value: entry.value as T };
}

/**
 * Stores `value` under `key`.
 *
 * Returns `true` when it was written. A quota error drops the oldest half and
 * retries once — a full store must not stop the section from working.
 */
export function writeSnapshot<T>(
  key: string,
  value: T,
  storage: StorageLike | null = defaultStorage(),
  now = Date.now()
): boolean {
  if (!storage || typeof storage.setItem !== "function") return false;

  let serialized: string;
  try {
    serialized = JSON.stringify({ v: SNAPSHOT_VERSION, at: now, value });
  } catch {
    return false;
  }
  if (serialized.length > MAX_ENTRY_BYTES) return false;

  const store = readStore(storage);
  store[key] = { v: SNAPSHOT_VERSION, at: now, value };

  const keys = Object.keys(store);
  // Newest first, then trim to the entry and byte budgets.
  keys.sort((a, b) => (store[b]?.at ?? 0) - (store[a]?.at ?? 0));
  const kept: Record<string, SnapshotEntry<unknown>> = {};
  let total = 0;
  for (const entryKey of keys) {
    const entry = store[entryKey];
    if (!entry) continue;
    let size = 0;
    try {
      size = JSON.stringify(entry).length;
    } catch {
      continue;
    }
    if (Object.keys(kept).length >= MAX_ENTRIES) break;
    if (total + size > MAX_TOTAL_BYTES && Object.keys(kept).length > 0) break;
    kept[entryKey] = entry;
    total += size;
  }

  const persist = (payload: Record<string, SnapshotEntry<unknown>>) => {
    try {
      storage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  if (persist(kept)) return true;

  // Quota exceeded: keep only the newest few and try once more.
  const smallest: Record<string, SnapshotEntry<unknown>> = {};
  const newest = Object.keys(kept).slice(0, 4);
  for (const entryKey of newest) {
    const entry = kept[entryKey];
    if (entry) smallest[entryKey] = entry;
  }
  return persist(smallest);
}

/** Removes every exclusive snapshot (used by "clear cached data"). */
export function clearSnapshots(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem?.(SNAPSHOT_KEY);
  } catch {
    /* storage may be read-only */
  }
}

/** Keys currently stored — diagnostics and tests. */
export function snapshotKeys(storage: StorageLike | null = defaultStorage()): string[] {
  return Object.keys(readStore(storage));
}
