import { NextRequest } from "next/server";
import { memberByToken, normalizeCode, sweep, touch, setTyping } from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/rooms/{code}/typing (header: x-room-token) body: { typing: boolean } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");
  let typing = false;
  try {
    const body = (await req.json()) as { typing?: unknown };
    typing = body.typing === true;
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const now = Date.now();
  let me: ReturnType<typeof memberByToken> = null;
  let rec;
  try {
    rec = await roomStore().mutate(code, (room) => {
      sweep(room, now);
      me = memberByToken(room, token);
      if (!me) return false;
      const touched = touch(room, me.id, now);
      const changed = setTyping(room, me.id, now, typing);
      return touched || changed;
    });
  } catch (error) {
    console.error("room typing failed", error);
    return json({ error: "Typing unavailable" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "This room has ended", ended: true }, 404);
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);
  return json(roomPayload(rec, me));
}
