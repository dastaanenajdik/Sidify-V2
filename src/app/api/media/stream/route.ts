import { NextRequest } from "next/server";
import { proxyMediaStreamRequest } from "@/lib/media/streamProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return proxyMediaStreamRequest(request);
}

export async function HEAD(request: NextRequest) {
  return proxyMediaStreamRequest(request);
}
