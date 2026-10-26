import { ANDROID_APP } from "@/lib/appRelease";

/**
 * Tiny helpers around the "get the app" download link.
 *
 * The canonical download link is `ANDROID_APP.apkUrl` — GitHub's "latest
 * release" URL for `app-release.apk`. The Download APK buttons, the QR code
 * (`/api/qr`) and the copy/share text all use that exact link, so every tap,
 * scan or paste downloads from the same place.
 *
 * `SHORT_PATH` (`/get`, served by `src/app/get/route.ts`) is kept as a legacy
 * alias: it 307-redirects to the same `apkUrl`, so older shared/printed links
 * keep working.
 */

export const SHORT_PATH = "/get";

/** Absolute short link for a given origin (client: `window.location.origin`). */
export function shortLinkFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${SHORT_PATH}`;
}

/** Share text used by the copy buttons — WhatsApp-friendly. */
export function shareText(): string {
  return `Sidify app (Android APK, free) — direct download:\n${ANDROID_APP.apkUrl}`;
}

/** QR image endpoint on this same origin (encodes `ANDROID_APP.apkUrl`). */
export function qrImagePath(size = 512, format: "png" | "svg" = "png"): string {
  return `/api/qr?format=${format}&size=${size}`;
}
