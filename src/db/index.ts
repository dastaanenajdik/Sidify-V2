import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The Postgres pool is created **lazily** — on first real query, not at import time.
 *
 * Importing this module must not require a runtime secret. `next build` imports every
 * route module during its "Collecting page data" phase, so a top-level `throw` here
 * fails the whole build in any environment where `DATABASE_URL` is absent (Preview
 * deployments, CI, a fresh clone) even though the database is only needed once a
 * request actually runs. Deferring the check keeps builds environment-independent.
 *
 * Runtime behaviour is unchanged: the same error surfaces, just on first use instead
 * of on boot. Every call site keeps working untouched — `db` is a Proxy that resolves
 * to the real Drizzle instance on access, so `db.select()`, `db.insert()`,
 * `db.delete()` and `db.execute()` behave exactly as before.
 */

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return databaseUrl;
}

let poolInstance: Pool | null = null;
let dbInstance: NodePgDatabase | null = null;

/** Resolves (creating on first use) the shared connection pool. */
export function getPool(): Pool {
  // In dev, reuse the pool across hot reloads so connections aren't leaked per recompile.
  const hotReloadPool = globalForDb.__arenaNextJsPostgresqlPool;
  if (hotReloadPool) return hotReloadPool;
  if (poolInstance) return poolInstance;

  const created = new Pool({ connectionString: requireDatabaseUrl() });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = created;
  }
  poolInstance = created;

  return created;
}

/** Resolves (creating on first use) the Drizzle ORM instance. */
export function getDb(): NodePgDatabase {
  if (!dbInstance) dbInstance = drizzle(getPool());
  return dbInstance;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, _receiver) {
      const real = resolve();
      const value = Reflect.get(real, prop, real);
      // Bind so methods keep their receiver when called as `db.select()`.
      return typeof value === "function" ? value.bind(real) : value;
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
    set(_target, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
  });
}

export const pool = lazyProxy<Pool>(getPool);
export const db = lazyProxy<NodePgDatabase>(getDb);
