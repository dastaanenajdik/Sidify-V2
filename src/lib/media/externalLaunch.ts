/**
 * Browser-side helpers for handing an already-resolved direct stream URL to VLC or
 * another installed video player.
 *
 * Mobile browsers (Android Chrome, iOS Safari) only allow `intent:` and custom-scheme
 * navigations inside a synchronous user gesture — never after an `await fetch()`.
 * Therefore UI components must resolve links FIRST and render real `<a href={plan.href}>`
 * elements for phone launches, using `saveTextFile()` only for desktop `.m3u` downloads.
 */

import {
  detectClientPlatform,
  externalPlayerOptions,
  vlcLaunchPlan,
  type ClientPlatform,
  type ExternalPlayerOption,
  type PlatformEnv,
  type VlcLaunchPlan,
} from "./externalPlayers";

export type SavedFile = NonNullable<ExternalPlayerOption["file"]>;

interface NavigatorWithUAData extends Navigator {
  userAgentData?: { platform?: string };
}

function browserEnv(env?: PlatformEnv): PlatformEnv {
  if (env) return env;
  if (typeof navigator === "undefined") return {};
  const nav = navigator as NavigatorWithUAData;
  const canMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    uaDataPlatform: nav.userAgentData?.platform,
    maxTouchPoints: nav.maxTouchPoints,
    hasFinePointer: canMatchMedia ? window.matchMedia("(pointer: fine)").matches : undefined,
  };
}

/** The platform the player-app links should be built for. */
export function clientPlatform(env?: PlatformEnv): ClientPlatform {
  return detectClientPlatform(browserEnv(env));
}

/** Open an app through its URL scheme (only call synchronously inside a user gesture). */
export function openAppLink(href: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.rel = "noreferrer noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Save a small text file (an `.m3u` playlist) — the desktop path into VLC. */
export function saveTextFile(file: SavedFile): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Do whatever a player-app option says: open the app, or save the playlist file. */
export function openExternalPlayerOption(option: ExternalPlayerOption): void {
  if (option.href) openAppLink(option.href);
  else if (option.file) saveTextFile(option.file);
}

export interface VlcHandoff {
  plan: VlcLaunchPlan;
  /** The other player apps for the same link (MX Player, Other app, Infuse, IINA…). */
  others: ExternalPlayerOption[];
}

/**
 * Compute the VLC launch plan plus secondary installed-player options for one resolved
 * direct URL without firing side effects, so React renders real `<a href>` elements.
 */
export function buildVlcHandoff(url: string, options: { title?: string; env?: PlatformEnv } = {}): VlcHandoff | null {
  const platform = clientPlatform(options.env);
  const plan = vlcLaunchPlan(url, { title: options.title, platform });
  if (!plan) return null;
  return {
    plan,
    others: externalPlayerOptions(url, { title: options.title, platform }).filter(
      (option) => option.id !== "vlc" && option.id !== "m3u"
    ),
  };
}

/**
 * Start VLC synchronously for an already-resolved link on the current device.
 */
export function playWithVlc(url: string, options: { title?: string; env?: PlatformEnv } = {}): VlcHandoff | null {
  const handoff = buildVlcHandoff(url, options);
  if (!handoff) return null;
  openExternalPlayerOption(
    handoff.plan.href
      ? { id: "vlc", label: "VLC", href: handoff.plan.href }
      : { id: "m3u", label: "VLC", file: handoff.plan.file }
  );
  return handoff;
}
