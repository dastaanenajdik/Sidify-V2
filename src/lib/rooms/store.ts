import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "@/db";
import { randomCode, type RoomRecord } from "./logic";

/**
 * Where rooms live.
 *
 * With `DATABASE_URL` set, each room is a row in `listen_rooms`, changed inside
 * a transaction holding the row lock — so any number of server instances
 * (serverless included) agree on one room. Without a database the rooms live
 * in this process's memory: perfect for a single dev server or a long-running
 * Node host, not for serverless fan-out.
 */

export type Mutator = (rec: RoomRecord) => boolean | void;

export interface RoomStore {
  kind: "postgres" | "memory";
  /** Inserts a brand-new room; false when the code is taken. */
  create(rec: RoomRecord): Promise<boolean>;
  read(code: string): Promise<RoomRecord | null>;
  /**
   * Runs `fn` against the room under a lock. Return `false` from `fn` to skip
   * the write (nothing changed). Set `rec.dead` to delete the room.
   * Resolves to the record after the change, or null when there is no room.
   */
  mutate(code: string, fn: Mutator): Promise<RoomRecord | null>;
}

/* --------------------------------- memory --------------------------------- */

const g = globalThis as typeof globalThis & { __sidifyRooms?: Map<string, RoomRecord> };

function memoryStore(): RoomStore {
  const rooms = (g.__sidifyRooms ??= new Map<string, RoomRecord>());
  const clone = (r: RoomRecord): RoomRecord => structuredClone(r);
  return {
    kind: "memory",
    async create(rec) {
      if (rooms.has(rec.code)) return false;
      rooms.set(rec.code, clone(rec));
      return true;
    },
    async read(code) {
      const r = rooms.get(code);
      return r ? clone(r) : null;
    },
    async mutate(code, fn) {
      const current = rooms.get(code);
      if (!current) return null;
      const rec = clone(current);
      const write = fn(rec) !== false;
      if (rec.dead) {
        rooms.delete(code);
        return rec;
      }
      if (write) rooms.set(code, clone(rec));
      return rec;
    },
  };
}

/* -------------------------------- postgres -------------------------------- */

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  tableReady ??= getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS listen_rooms (
         code text PRIMARY KEY,
         data jsonb NOT NULL,
         created_at timestamp NOT NULL DEFAULT now(),
         updated_at timestamp NOT NULL DEFAULT now()
       )`
    )
    .then(() => undefined)
    .catch((e) => {
      tableReady = null;
      throw e;
    });
  return tableReady;
}

function postgresStore(): RoomStore {
  return {
    kind: "postgres",
    async create(rec) {
      await ensureTable();
      const res = await getPool().query(
        "INSERT INTO listen_rooms (code, data) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING",
        [rec.code, JSON.stringify(rec)]
      );
      // Opportunistic cleanup of rooms that were abandoned long ago.
      void getPool()
        .query("DELETE FROM listen_rooms WHERE updated_at < now() - interval '13 hours'")
        .catch(() => {});
      return (res.rowCount ?? 0) > 0;
    },
    async read(code) {
      await ensureTable();
      const res = await getPool().query("SELECT data FROM listen_rooms WHERE code = $1", [code]);
      return res.rows[0] ? (res.rows[0].data as RoomRecord) : null;
    },
    async mutate(code, fn) {
      await ensureTable();
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const res = await client.query("SELECT data FROM listen_rooms WHERE code = $1 FOR UPDATE", [code]);
        if (!res.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }
        const rec = res.rows[0].data as RoomRecord;
        const write = fn(rec) !== false;
        if (rec.dead) await client.query("DELETE FROM listen_rooms WHERE code = $1", [code]);
        else if (write)
          await client.query("UPDATE listen_rooms SET data = $2, updated_at = now() WHERE code = $1", [
            code,
            JSON.stringify(rec),
          ]);
        await client.query("COMMIT");
        return rec;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

let store: RoomStore | null = null;

export function roomStore(): RoomStore {
  store ??= process.env.DATABASE_URL ? postgresStore() : memoryStore();
  return store;
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function newMemberId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/** A free six-character code. */
export async function freeCode(): Promise<string> {
  const s = roomStore();
  for (let i = 0; i < 12; i++) {
    const code = randomCode(() => randomBytes(1)[0] / 256);
    if (!(await s.read(code))) return code;
  }
  throw new Error("Could not allocate a room code");
}
