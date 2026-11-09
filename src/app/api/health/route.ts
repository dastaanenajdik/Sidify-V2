import { db, hasDatabaseUrl } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — the uptime probe.
 *
 * The app is deliberately local-first: without `DATABASE_URL` the whole library
 * (liked songs, playlists, downloads, history) lives in the browser and every
 * page and API still works. That deployment is *healthy*, so answering 500 there
 * was a bug — it made uptime monitors, deploy checks and the Vercel dashboard
 * report a working install as broken.
 *
 * A database that IS configured but cannot answer is a real fault, and that is
 * the only case that fails (503, so the probe is retried rather than cached).
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };

  if (!hasDatabaseUrl()) {
    return Response.json({ ok: true, storage: "local" }, { headers });
  }

  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, storage: "postgres" }, { headers });
  } catch {
    return Response.json({ ok: false, storage: "postgres" }, { status: 503, headers });
  }
}
