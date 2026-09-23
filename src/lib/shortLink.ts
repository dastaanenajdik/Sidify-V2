/**
 * Tiny helpers around the printable "get the app" link.
 *
 * `SHORT_PATH` is served by `src/app/get/route.ts`, which 307-redirects to the exact
 * APK asset in the GitHub release. Because the code stays stable, the printed QR can
 * outlive a single version — only that route has to point somewhere new.
 */

export const SHORT_PATH = "/get";

/** Absolute short link for a given origin (client: `window.location.origin`). */
export function shortLinkFor(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${SHORT_PATH}`;
}

/** Share text used by the copy buttons — WhatsApp-friendly. */
export function shareText(origin: string): string {
  const link = shortLinkFor(origin);
  return `Sidify app (Android APK, free) — direct download:\n${link}`;
}

/** QR image endpoint on this same origin. */
export function qrImagePath(size = 512, format: "png" | "svg" = "png"): string {
  return `/api/qr?format=${format}&size=${size}`;
}
