import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { ANDROID_APP } from "@/lib/appRelease";

/**
 * QR code for the direct APK download link (`ANDROID_APP.apkUrl`) — the exact
 * same GitHub "latest release" URL the Download APK buttons point to, so
 * scanning the QR starts the same download as tapping the button.
 *
 * Server-rendered on purpose: the QR bytes never touch the dark theme, and the same
 * URL works for the page artwork, a downloaded print file and a plain `<img>` tag.
 * GET /api/qr?format=png|svg&size=512
 */

export const dynamic = "force-dynamic";

const MIN_SIZE = 128;
const MAX_SIZE = 1024;
const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "svg" ? "svg" : "png";
  const requested = Number(searchParams.get("size"));
  const size = Number.isFinite(requested) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(requested))) : 512;

  const link = ANDROID_APP.apkUrl;
  const options = {
    errorCorrectionLevel: "M" as const,
    margin: 2,
    width: size,
    color: { dark: "#0b0b12", light: "#ffffff" },
  };

  try {
    if (format === "svg") {
      const svg = await QRCode.toString(link, { ...options, type: "svg" });
      return new NextResponse(svg, {
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": CACHE,
        },
      });
    }

    const png = await QRCode.toBuffer(link, { ...options, type: "png" });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.byteLength),
        "cache-control": CACHE,
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not render the QR code" }, { status: 500 });
  }
}
