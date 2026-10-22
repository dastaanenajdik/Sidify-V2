/**
 * Developer diagnostics for resolve / playback failures.
 *
 * The UI only ever says "Something went wrong". The specifics — HTTP status of the resolve
 * call, media error code, readyState / networkState, HLS error category — go to the
 * browser console under one prefix, so a failure on a preview can be diagnosed from a
 * DevTools screenshot. Resolved links carry signed tokens, so URLs are reduced to host +
 * file name: query strings and fragments are never logged.
 */
export const DIAGNOSTIC_PREFIX = "[Sidify media]";

/** `host/…/last-segment` without query or fragment — safe to log and to share. */
export function redactUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";
    const name = last.length > 60 ? `${last.slice(0, 57)}…` : last;
    if (!name) return parsed.host;
    return segments.length > 1 ? `${parsed.host}/…/${name}` : `${parsed.host}/${name}`;
  } catch {
    return "";
  }
}

export type DiagnosticDetails = Record<string, string | number | boolean | null | undefined>;

export function reportMediaDiagnostic(event: string, details: DiagnosticDetails): void {
  if (typeof console === "undefined") return;
  const clean: DiagnosticDetails = {};
  for (const [key, value] of Object.entries(details)) if (value !== undefined) clean[key] = value;
  console.warn(`${DIAGNOSTIC_PREFIX} ${event}`, clean);
}
