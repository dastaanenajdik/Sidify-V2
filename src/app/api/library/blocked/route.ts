import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { blockedArtists } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { withDatabase, withDatabaseWrite } from "@/lib/dbResponses";
import { readJsonBody } from "@/lib/readJsonBody";

export const dynamic = "force-dynamic";

export async function GET() {
  return withDatabase({ artists: [] }, async () => {
    const rows = await db.select().from(blockedArtists).orderBy(desc(blockedArtists.blockedAt)).limit(500);
    return NextResponse.json({
      artists: rows.map((r) => ({ artistId: r.artistId, name: r.name, blockedAt: r.blockedAt.toISOString() })),
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody<{ artistId: string; name: string }>(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { artistId, name } = body;
  if (!artistId) return NextResponse.json({ error: "artistId required" }, { status: 400 });
  return withDatabaseWrite(async () => {
    await db.insert(blockedArtists).values({ artistId, name: name || "Unknown" }).onConflictDoNothing();
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return withDatabaseWrite(async () => {
    await db.delete(blockedArtists).where(eq(blockedArtists.artistId, id));
    return NextResponse.json({ ok: true });
  });
}
