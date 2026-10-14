import { NextRequest } from "next/server";
import { memberByToken, normalizeCode, removeMember } from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { json } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/rooms/{code}/leave   (header: x-room-token) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");
  try {
    await roomStore().mutate(code, (r) => {
      const me = memberByToken(r, token);
      if (!me) return false;
      removeMember(r, me.id, Date.now(), "left");
      return true;
    });
  } catch {
    /* leaving is best-effort */
  }
  return json({ ok: true });
}
