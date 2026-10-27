import { NextRequest, after } from "next/server";
import { currentOf, memberByToken, needsFill, normalizeCode, sweep, touch, type RoomMember } from "@/lib/rooms/logic";
import { roomStore } from "@/lib/rooms/store";
import { fillAutoplay, json, roomPayload } from "@/lib/rooms/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/rooms/{code}?since={seq}   (header: x-room-token)
 *
 * Members poll this about once a second; it doubles as their heartbeat. When
 * nothing changed since `since`, the answer is tiny: `{ changed: false }` plus
 * presence. Without a token it returns a public preview for the join screen.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);
  const token = req.headers.get("x-room-token");
  const since = Number(req.nextUrl.searchParams.get("since") || 0);
  const seenId = req.nextUrl.searchParams.get("seen");
  const now = Date.now();
  let me: RoomMember | null = null;

  let rec;
  try {
    rec = await roomStore().mutate(code, (r) => {
      const swept = sweep(r, now);
      me = memberByToken(r, token);
      const touched = me ? touch(r, me.id, now) : false;
      // Read receipts: advance this member's "read up to" cursor when they've
      // seen a newer chat message than before.
      let seenAdvanced = false;
      if (me && seenId && r.chat && r.chat.length) {
        const target = r.chat.findIndex((m) => m.id === seenId);
        if (target >= 0) {
          const current = me.readUpTo ? r.chat.findIndex((m) => m.id === me!.readUpTo) : -1;
          if (target > current) {
            me.readUpTo = seenId;
            seenAdvanced = true;
          }
        }
      }
      return swept || touched || seenAdvanced;
    });
  } catch (e) {
    console.error("room read failed", e);
    return json({ error: "Rooms are unavailable right now" }, 503);
  }
  if (!rec || rec.dead) return json({ error: "This room has ended", ended: true }, 404);

  if (!token) {
    const host = rec.members.find((m) => m.id === rec.hostId);
    const track = currentOf(rec);
    return json({
      preview: {
        code: rec.code,
        name: rec.name,
        hostName: host?.name ?? "",
        memberCount: rec.members.length,
        maxMembers: rec.maxMembers,
        track: track ? { title: track.title, artist: track.artist, artwork: track.artwork } : null,
      },
      serverMs: Date.now(),
    });
  }
  if (!me) return json({ error: "You're no longer in this room", removed: true }, 403);

  if (needsFill(rec) && now - rec.lastFillAt > 20_000) after(() => fillAutoplay(code));

  if (since && rec.seq === since) {
    return json({
      changed: false,
      presence: rec.members.map((m) => [m.id, Math.max(0, now - m.lastSeen)]),
      serverMs: Date.now(),
    });
  }
  return json(roomPayload(rec, me, { changed: true }));
}
