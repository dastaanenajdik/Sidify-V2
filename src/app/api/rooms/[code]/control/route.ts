import { NextRequest, after } from "next/server";
import {
  applyControl,
  currentOf,
  memberByToken,
  normalizeCode,
  sweep,
  touch,
  upcomingCount,
  type ControlAction,
  type ControlResult,
  type RoomMember,
} from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { fillAutoplay, json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/rooms/{code}/control   (header: x-room-token)
 * Body: { action: ControlAction } → the room after the change.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");
  let action: ControlAction | null = null;
  try {
    const body = (await req.json()) as { action?: ControlAction };
    action = body.action && typeof body.action === "object" && typeof body.action.type === "string" ? body.action : null;
  } catch {
    action = null;
  }
  if (!action) return json({ error: "Bad request" }, 400);

  const now = Date.now();
  let me: RoomMember | null = null;
  let result: ControlResult | null = null;
  let endTrackId: string | null = null;

  let rec;
  try {
    rec = await roomStore().mutate(code, (r) => {
      sweep(r, now);
      me = memberByToken(r, token);
      if (!me) return false;
      touch(r, me.id, now);
      result = applyControl(r, me, action!, now);
      const cur = currentOf(r);
      // Skipping (or finishing) the last song with AutoPlay on waits for the fill.
      if (result.ok && result.needsFill && (action!.type === "next" || action!.type === "ended") && upcomingCount(r) === 0 && cur) {
        endTrackId = cur.id;
      }
      return true;
    });
  } catch (e) {
    console.error("room control failed", e);
    return json({ error: "Rooms are unavailable right now" }, 503);
  }
  if (!rec) return json({ error: "This room has ended", ended: true }, 404);
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);
  const res = result as ControlResult | null;
  if (!res) return json({ error: "Bad request" }, 400);
  if (!res.ok) return json({ error: res.error, ...roomPayload(rec, me) }, res.status);
  if (rec.dead) return json({ ended: true, serverMs: Date.now() });

  if (endTrackId) {
    const by = (me as RoomMember).name;
    await fillAutoplay(code, { force: true, advanceAfter: { trackId: endTrackId, by } });
    const fresh = await roomStore().read(code);
    if (fresh) return json(roomPayload(fresh, me));
  } else if (res.needsFill) {
    after(() => fillAutoplay(code, { force: true }));
  }
  return json(roomPayload(rec, me));
}
