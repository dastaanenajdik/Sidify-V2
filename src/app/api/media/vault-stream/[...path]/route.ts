import { NextRequest, NextResponse } from "next/server";
import {
  decodeVaultStreamToken,
  fetchVaultStream,
  isDashManifest,
  MAX_MANIFEST_BYTES,
  resolveVaultSegmentUrl,
  rewriteDashManifest,
  VAULT_STREAM_PATH,
  VaultStreamError,
} from "@/lib/media/vaultStream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/media/vault-stream/<token>
 * GET /api/media/vault-stream/<token>/<segment>
 *
 * Relays a signed CDN request (manifest or segment) with the headers the CDN expects.
 *
 * The token carries the upstream URL and the headers needed to authorise it. Only
 * allowlisted CDN hosts are reachable, upstream addresses must be public, and only
 * `Cookie` / `Referer` / `User-Agent` are forwarded.
 *
 * A DASH manifest is rewritten so its segments are requested through this route too —
 * a browser cannot attach the signed cookie to a cross-origin segment request.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;

  // Cross-site hotlink requests are rejected: this relay exists for our own player.
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site relay requests are not allowed.", code: "disallowed_host" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const segments = path ?? [];
  const token = segments[0];
  if (!token) {
    return NextResponse.json(
      { error: "Missing relay token.", code: "malformed_url" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const descriptor = decodeVaultStreamToken(token);
  if (!descriptor) {
    return NextResponse.json(
      { error: "Invalid relay token.", code: "malformed_url" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  // Anything below the token is a DASH segment: resolve it against the directory the
  // manifest was served from.
  const segment = segments.slice(1).join("/");
  let upstreamUrl = descriptor.u;
  if (segment) {
    const resolved = resolveVaultSegmentUrl(descriptor.b, segment);
    if (!resolved) {
      return NextResponse.json(
        { error: "Invalid segment path.", code: "malformed_url" },
        { status: 400, headers: { "cache-control": "no-store" } }
      );
    }
    upstreamUrl = resolved;
  }

  const range = req.headers.get("range");

  try {
    const result = await fetchVaultStream(upstreamUrl, descriptor.h, range);

    const contentType = result.headers.get("content-type");

    // DASH manifests are rewritten so their segments are relayed as well.
    if (!segment && isDashManifest(contentType) && result.body) {
      const reader = result.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_MANIFEST_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.length;
        chunks.push(value);
      }
      await reader.cancel().catch(() => {});

      const manifest = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
      const origin = req.nextUrl.origin;
      const relayBase = `${origin}${VAULT_STREAM_PATH}/${token}`;
      const rewritten = rewriteDashManifest(manifest, relayBase);

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "content-type": "application/dash+xml; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (!result.body) {
      return new NextResponse(null, { status: result.status, headers: result.headers });
    }

    return new NextResponse(result.body, {
      status: result.status,
      headers: result.headers,
    });
  } catch (error) {
    if (error instanceof VaultStreamError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "cache-control": "no-store" } }
      );
    }
    console.error("[api/media/vault-stream]", error);
    return NextResponse.json(
      { error: "Relay request failed.", code: "network_error" },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return GET(req, ctx);
}
