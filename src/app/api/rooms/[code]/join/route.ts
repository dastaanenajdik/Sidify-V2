import { NextRequest } from "next/server";
import { addMember, memberByToken, normalizeCode, sweep, touch, type RoomMember } from "@/lib/rooms/logic";
import { newMemberId, newToken, roomStore } from "@/lib/rooms/store";
import { json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/rooms/{code}/join — Body: { name, token? }
 * A known token rejoins the same seat (page reloads, flaky networks).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* defaults */
  }
  const now = Date.now();
  const existingToken = typeof body.token === "string" ? body.token : null;
  let token = existingToken ?? newToken();
  let memberId = "";
  let failure: { status: number; error: string } | null = null;
  let me: RoomMember | null = null;

  let rec;
  try {
    rec = await roomStore().mutate(code, (r) => {
      sweep(r, now);
      const known = memberByToken(r, existingToken);
      if (known) {
        me = known;
        memberId = known.id;
        touch(r, known.id, now);
        return true;
      }
      token = newToken();
      memberId = newMemberId();
      const res = addMember(r, { id: memberId, name: String(body.name ?? ""), token }, now);
      if (!res.ok) {
        failure = { status: res.status, error: res.error };
        return false;
      }
      me = r.members.find((m) => m.id === memberId) ?? null;
      return true;
    });
  } catch (e) {
    console.error("room join failed", e);
    return json({ error: "Rooms are unavailable right now" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "No room with that code — check it and try again" }, 404);
  if (failure) {
    const f = failure as { status: number; error: string };
    return json({ error: f.error }, f.status);
  }
  return json({ code, token, memberId, ...roomPayload(rec, me) });
}
