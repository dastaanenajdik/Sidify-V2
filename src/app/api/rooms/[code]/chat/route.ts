import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { memberByToken, normalizeCode, ROOM_LIMITS, sweep, touch } from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/rooms/{code}/chat (header: x-room-token) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");
  let text = "";
  let messageId = "";
  try {
    const body = (await req.json()) as { text?: unknown; id?: unknown };
    text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, ROOM_LIMITS.chatMessageLength) : "";
    messageId = typeof body.id === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.id) ? body.id : randomUUID();
  } catch {
    return json({ error: "Enter a message to send" }, 400);
  }
  if (!text) return json({ error: "Enter a message to send" }, 400);

  const now = Date.now();
  let me: ReturnType<typeof memberByToken> = null;
  let rec;
  try {
    rec = await roomStore().mutate(code, (room) => {
      sweep(room, now);
      me = memberByToken(room, token);
      if (!me) return false;
      const touched = touch(room, me.id, now);
      // Older rooms may predate the chat field.
      const chat = (room.chat ??= []);
      const alreadySent = chat.some((message) => message.id === messageId && message.memberId === me!.id);
      if (!alreadySent) {
        chat.push({ id: messageId, at: now, memberId: me.id, by: me.name, text });
        room.chat = chat.slice(-ROOM_LIMITS.chatMessages);
        room.seq++;
      }
      return !alreadySent || touched;
    });
  } catch (error) {
    console.error("room chat failed", error);
    return json({ error: "Chat is unavailable right now" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "This room has ended", ended: true }, 404);
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);
  return json(roomPayload(rec, me));
}
