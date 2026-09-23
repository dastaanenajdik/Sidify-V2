import { NextResponse } from "next/server";
import { ANDROID_APP } from "@/lib/appRelease";

/**
 * The printable short link: `<site>/get`.
 *
 * It 307-redirects straight to the APK asset of the GitHub release, so the same QR
 * code and the same typed link keep working across versions — only `ANDROID_APP`
 * has to be updated. We use a temporary redirect on purpose: app files are large and
 * want to stay uncached by intermediaries, and the target is free to move.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(ANDROID_APP.apkUrl, 307);
}
