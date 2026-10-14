import { NextRequest, after } from "next/server";
import { needsFill, newRoom } from "@/lib/rooms/logic";
import { freeCode, newMemberId, newToken, roomStore } from "@/lib/rooms/store";
import { fillAutoplay, json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/rooms — start a Listen Together room.
 * Body: { name, hostOnly?, autoplay?, seed?: { queue, index, positionMs, isPlaying } }
 * → { code, token, memberId, room, serverMs }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }
  const store = roomStore();
  const token = newToken();
  const memberId = newMemberId();
  const seed = body.seed && typeof body.seed === "object" ? (body.seed as { queue: unknown[]; index: number; positionMs: number; isPlaying: boolean }) : null;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = await freeCode();
      const rec = newRoom({
        code,
        hostId: memberId,
        hostName: String(body.name ?? ""),
        token,
        now: Date.now(),
        hostOnly: body.hostOnly === true,
        autoplay: body.autoplay !== false,
        seed,
      });
      if (await store.create(rec)) {
        if (needsFill(rec)) after(() => fillAutoplay(code, { force: true }));
        const me = rec.members[0];
        return json({ code, token, memberId, ...roomPayload(rec, me) });
      }
    }
    return json({ error: "Couldn't create a room, try again" }, 503);
  } catch (e) {
    console.error("room create failed", e);
    return json({ error: "Rooms are unavailable right now" }, 503);
  }
}
