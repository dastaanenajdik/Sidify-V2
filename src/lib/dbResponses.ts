import { NextResponse } from "next/server";
import { hasDatabaseUrl } from "@/db";

/**
 * Shared answers for the library routes, which all sit on Postgres.
 *
 * The app is **local-first**: every library change is written to the browser's
 * localStorage and only mirrored to Postgres when a database is reachable. A deploy
 * without `DATABASE_URL` is therefore a supported, working configuration — the
 * browser keeps the library and the server simply has nothing to add.
 *
 * The routes used to answer `503 Database not configured` in that case. Two things
 * went wrong with that:
 *
 *   1. The browser's console filled with red errors on every page load, even though
 *      the app worked fine.
 *   2. The client treats any non-2xx as "the backend is down" and then stops
 *      calling the library API for a while (`src/lib/clientApi.ts`). One missing
 *      database therefore silenced *every* library request, including ones that
 *      could have succeeded.
 *
 * So the "no database configured" case now answers `200` with an empty list, which
 * is exactly what the client expects. A database that is configured but *broken*
 * still answers `503` — that one really is an outage worth reporting.
 */

/**
 * The response for a database-less deploy: a normal, empty answer.
 *
 * `empty` is the collection the route would have returned — e.g. `{ playlists: [] }`.
 */
export function databaseNotConfigured<T extends Record<string, unknown>>(empty: T) {
  return NextResponse.json(empty, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

/** The response for a database that is configured but not answering. */
export function databaseUnavailable<T extends Record<string, unknown>>(empty: T) {
  return NextResponse.json(
    { error: "Database unavailable", ...empty },
    { status: 503, headers: { "cache-control": "no-store" } }
  );
}

/**
 * Runs a database-backed read.
 *
 * Without a database the empty answer is returned, so the caller never has to
 * special-case it. With a database the query runs, and a failure is reported as an
 * outage.
 */
export async function withDatabase<T extends Record<string, unknown>>(
  empty: T,
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) return databaseNotConfigured(empty);
  try {
    return await run();
  } catch {
    return databaseUnavailable(empty);
  }
}

/**
 * The write-side twin of `withDatabase`.
 *
 * A write without a database is not an error either: the browser already holds the
 * change in its local library, so the server simply acknowledges it and has nothing
 * to store.
 */
export async function withDatabaseWrite(
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { ok: true, stored: false },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
  try {
    return await run();
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
