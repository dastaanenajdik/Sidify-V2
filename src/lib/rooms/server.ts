import { NextResponse } from "next/server";
import { ytRadioNext } from "@/lib/engine";
import {
  advance,
  appendAutoplay,
  currentOf,
  needsFill,
  publicRoom,
  upcomingCount,
  type RoomMember,
  type RoomRecord,
} from "./logic";
import { roomStore } from "./store";

/** Shared bits of the /api/rooms routes. */

export const NO_STORE = { "cache-control": "no-store" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function roomPayload(rec: RoomRecord, me: RoomMember | null, extra: Record<string, unknown> = {}) {
  return { room: publicRoom(rec), you: me?.id ?? null, store: roomStore().kind, ...extra, serverMs: Date.now() };
}

const filling = new Set<string>();

/**
 * Tops the room up with similar songs (YouTube Music's own "up next" for the
 * current track). With `advanceAfter`, also moves on to the first of them — the
 * end-of-queue case, where the room is waiting on this fetch.
 */
export async function fillAutoplay(code: string, opts: { force?: boolean; advanceAfter?: { trackId: string; by: string } } = {}) {
  const store = roomStore();
  const rec = await store.read(code);
  if (!rec || !needsFill(rec)) return;
  if (!opts.force && Date.now() - rec.lastFillAt < 20_000) return;
  if (filling.has(code) && !opts.advanceAfter) return;
  const seed = currentOf(rec);
  if (!seed?.videoId) return;
  filling.add(code);
  let tracks: unknown[] = [];
  try {
    tracks = await ytRadioNext(seed.videoId, 14);
  } catch {
    tracks = [];
  } finally {
    filling.delete(code);
  }
  await store.mutate(code, (r) => {
    const now = Date.now();
    const added = appendAutoplay(r, tracks, now);
    const cur = currentOf(r);
    if (opts.advanceAfter && cur?.id === opts.advanceAfter.trackId && upcomingCount(r) > 0) {
      advance(r, now, opts.advanceAfter.by, true);
      return true;
    }
    if (opts.advanceAfter && cur?.id === opts.advanceAfter.trackId && added === 0) {
      // Nothing similar could be found: stop at the end instead of hanging.
      advance(r, now, opts.advanceAfter.by, true);
      return true;
    }
    return true;
  });
}
