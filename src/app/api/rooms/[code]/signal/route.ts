import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  memberByToken,
  normalizeCode,
  queueSignal,
  setVoicePresence,
  sweep,
  touch,
  type RoomSignalKind,
} from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = new Set(["offer", "answer", "candidate", "bye"]);

/**
 * POST /api/rooms/{code}/signal  (header: x-room-token)
 * Body: { kind: "offer"|"answer"|"candidate"|"bye", to?: memberId, data?: string,
 *         join?: boolean, leave?: boolean }
 *
 * The WebRTC signaling relay. It rides the same room document + token auth as
 * chat: envelopes are stored on the room and collected by the recipient's
 * regular 500ms poll. `join`/`leave` flip the sender's voice-call presence so
 * the other seat sees an incoming call / a hang-up even before SDP arrives.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Malformed signal" }, 400);
  }
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (!KINDS.has(kind)) return json({ error: "Unknown signal kind" }, 400);
  const to = typeof body.to === "string" ? body.to : "";
  const data = typeof body.data === "string" ? body.data : "";
  const joining = body.join === true;
  const leaving = body.leave === true || kind === "bye";

  const now = Date.now();
  let me: ReturnType<typeof memberByToken> = null;
  let rec;
  try {
    rec = await roomStore().mutate(code, (room) => {
      sweep(room, now);
      me = memberByToken(room, token);
      if (!me) return false;
      const touched = touch(room, me.id, now);
      if (joining) setVoicePresence(room, me.id, true);
      if (leaving) setVoicePresence(room, me.id, false);
      // Queued after the presence flip so a hang-up bye survives the purge of
      // older envelopes and still reaches the other seat on their next poll.
      // A bye for someone who already left the call has nowhere to go.
      if (to && (!leaving || room.voiceCall.includes(to))) {
        const queued = queueSignal(room, {
          id: randomUUID(),
          at: now,
          from: me.id,
          to,
          kind: kind as RoomSignalKind,
          data,
        });
        if (!queued) return false;
      }
      return touched || joining || leaving || true;
    });
  } catch (error) {
    console.error("room signal failed", error);
    return json({ error: "Signaling is unavailable right now" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "This room has ended", ended: true }, 404);
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);
  return json(roomPayload(rec, me));
}
