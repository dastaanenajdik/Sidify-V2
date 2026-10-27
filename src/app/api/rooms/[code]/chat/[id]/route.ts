import { NextRequest } from "next/server";
import { memberByToken, normalizeCode, ROOM_LIMITS, sweep, touch } from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PATCH /api/rooms/{code}/chat/{id} (header: x-room-token) — edit your own message. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code: rawCode, id } = await params;
  const code = normalizeCode(rawCode);
  const token = req.headers.get("x-room-token");
  const messageId = id && ID_RE.test(id) ? id : "";

  let text = "";
  try {
    const body = (await req.json()) as { text?: unknown };
    text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, ROOM_LIMITS.chatMessageLength) : "";
  } catch {
    return json({ error: "Enter a message" }, 400);
  }
  if (!messageId) return json({ error: "That message doesn't exist" }, 404);
  if (!text) return json({ error: "Message can't be empty" }, 400);

  const now = Date.now();
  let me: ReturnType<typeof memberByToken> = null;
  const outcome: { reason: "ok" | "notfound" | "forbidden" } = { reason: "ok" };
  let rec;
  try {
    rec = await roomStore().mutate(code, (room) => {
      sweep(room, now);
      me = memberByToken(room, token);
      if (!me) return false;
      const touched = touch(room, me.id, now);
      const chat = (room.chat ??= []);
      const message = chat.find((m) => m.id === messageId);
      if (!message) {
        outcome.reason = "notfound";
        return false;
      }
      if (message.memberId !== me.id) {
        outcome.reason = "forbidden";
        return false;
      }
      message.text = text;
      message.edited = true;
      room.seq++;
      return true || touched;
    });
  } catch (error) {
    console.error("room chat edit failed", error);
    return json({ error: "Chat is unavailable right now" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "This room has ended", ended: true }, 404);
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);
  if (outcome.reason === "notfound") return json({ error: "That message is gone" }, 404);
  if (outcome.reason === "forbidden") return json({ error: "You can only edit your own messages" }, 403);
  return json(roomPayload(rec, me));
}
