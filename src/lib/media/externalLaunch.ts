/**
 * The browser side of handing a direct link to another app.
 *
 * Two things a page can actually do: navigate to an app's own URL scheme (phones — the
 * OS routes it to VLC / MX Player / Infuse), or save a tiny playlist file a computer opens
 * in its default player. A web page cannot launch a desktop app, so the second one is the
 * honest desktop version of "Play with VLC"; both are best-effort, which is why the UI
 * always offers "Copy link" beside them.
 */

import { detectClientPlatform, externalPlayerOptions, vlcLaunchPlan, type ClientPlatform, type ExternalPlayerOption, type PlatformEnv, type VlcLaunchPlan } from "./externalPlayers";

export type SavedFile = NonNullable<ExternalPlayerOption["file"]>;

function browserEnv(env?: PlatformEnv): PlatformEnv {
  if (env) return env;
  if (typeof navigator === "undefined") return {};
  const fine = typeof window !== "undefined" && typeof window.matchMedia === "function";
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    hasFinePointer: fine ? window.matchMedia("(pointer: fine)").matches : undefined,
  };
}

/** The platform the player-app links should be built for. */
export function clientPlatform(env?: PlatformEnv): ClientPlatform {
  return detectClientPlatform(browserEnv(env));
}

/** Open an app through its URL scheme. An anchor click (not `location.href`) keeps it a
 *  plain "open with…" navigation, so the page stays where it is if nothing answers. */
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
  /** The other player apps for the same link (MX Player, Infuse, desktop playlist…). */
  others: ExternalPlayerOption[];
}

/**
 * Start VLC with this link on the current device, and return the other players it could
 * have used. `null` when the URL is not something a player app can be given.
 */
export function playWithVlc(url: string, options: { title?: string; env?: PlatformEnv } = {}): VlcHandoff | null {
  const platform = clientPlatform(options.env);
  const plan = vlcLaunchPlan(url, { title: options.title, platform });
  if (!plan) return null;
  openExternalPlayerOption(plan.href ? { id: "vlc", label: "VLC", href: plan.href } : { id: "m3u", label: "VLC", file: plan.file });
  // The other apps for the same link. VLC itself and the desktop playlist are what the
  // button already did, so they are not repeated.
  return {
    plan,
    others: externalPlayerOptions(url, { title: options.title, platform }).filter(
      (option) => option.id !== "vlc" && option.id !== "m3u"
    ),
  };
}
