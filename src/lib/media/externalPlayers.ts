/**
 * "Open in VLC / MX Player" links — platform-specific and strictly best-effort.
 *
 * External players stream the same direct HTTPS URL the browser would download (with
 * seeking, every codec, audio-track switching and subtitles), so they are the manual
 * fallback when in-browser playback shows a black screen or has no sound. Nothing here
 * contacts the media host; the user's own device opens the URL. Whether a link works
 * depends on which apps are installed, so the UI always keeps "Copy URL" next to them.
 *
 * IMPORTANT BROWSER GESTURE RULE:
 * On Android and iOS, custom-scheme / `intent:` links MUST sit inside a real `<a href>`
 * that is ALREADY rendered in the DOM before the user taps it. Calling `anchor.click()`
 * after an async `fetch()` loses transient user activation, so mobile browsers silently
 * block the app launch. Every resolved VLC link in the UI therefore renders `<a href>`
 * directly from `vlcLaunchPlan()`.
 */

export type ClientPlatform = "android" | "ios" | "mac" | "desktop";

export interface PlatformEnv {
  userAgent?: string;
  platform?: string;
  /** `navigator.userAgentData?.platform` — stays `"Android"` even in Chrome's "Desktop site" mode. */
  uaDataPlatform?: string;
  maxTouchPoints?: number;
  /**
   * `window.matchMedia("(pointer: fine)")` — a mouse/trackpad is the main pointer.
   *   - Apple Silicon Macs report `maxTouchPoints > 1` *and* the same "Macintosh" UA as an
   *     iPad in desktop mode, so fine pointer keeps laptops on `mac` while iPads stay `ios`.
   *   - Android Chrome with "Desktop site" enabled sends an `X11; Linux x86_64` UA while
   *     reporting touch points and `hasFinePointer === false`, so coarse touch Linux stays on
   *     `android` instead of saving an unusable `.m3u` file on a phone.
   */
  hasFinePointer?: boolean;
}

/** Coarse platform from browser signals. Mobile browsers in "Desktop site" mode stay mobile. */
export function detectClientPlatform(env: PlatformEnv | null | undefined): ClientPlatform {
  const ua = env?.userAgent || "";
  const uaDataPlatform = env?.uaDataPlatform || "";
  if (/Android/i.test(uaDataPlatform) || /Android/i.test(ua)) return "android";
  if (/iOS/i.test(uaDataPlatform) || /iPhone|iPad|iPod/i.test(ua)) return "ios";
  const touch = (env?.maxTouchPoints ?? 0) > 1;
  if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(env?.platform || "")) {
    return touch && !env?.hasFinePointer ? "ios" : "mac";
  }
  if ((/Linux|X11/i.test(ua) || /^Linux/i.test(env?.platform || "")) && touch && env?.hasFinePointer === false) {
    return "android";
  }
  return "desktop";
}

export interface ExternalPlayerOption {
  id: string;
  label: string;
  /** App / custom-scheme link. Absent for file-based options. */
  href?: string;
  /** A small playlist file the OS hands to the default desktop player. */
  file?: { fileName: string; mimeType: string; content: string };
  note?: string;
}

const PLAY_STORE = "https://play.google.com/store/apps/details?id=";
const VLC_ANDROID_PACKAGE = "org.videolan.vlc";

function withoutHash(url: string): string {
  const index = url.indexOf("#");
  return index === -1 ? url : url.slice(0, index);
}

/**
 * Android `intent:` URL that asks Chrome to hand an HTTPS media URL to an app.
 * With `packageName`, Chrome opens that app (or `browserFallbackUrl` when it is not
 * installed); without it Android shows its "Open with" chooser.
 */
export function androidIntentUrl(
  url: string,
  options: { packageName?: string; title?: string; browserFallbackUrl?: string } = {}
): string {
  const clean = withoutHash(url);
  const match = clean.match(/^(https?):\/\/(.+)$/i);
  if (!match) return clean;
  const [, scheme, rest] = match;
  const parts = [`scheme=${scheme.toLowerCase()}`, "action=android.intent.action.VIEW", "type=video/*"];
  if (options.packageName) parts.push(`package=${options.packageName}`);
  if (options.title) parts.push(`S.title=${encodeURIComponent(options.title)}`);
  if (options.browserFallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(options.browserFallbackUrl)}`);
  return `intent://${rest}#Intent;${parts.join(";")};end`;
}

/** Extended M3U playlist with a single entry — opens in VLC / IINA / mpv / PotPlayer. */
export function m3uPlaylist(url: string, title?: string): string {
  const name = String(title || "Stream").replace(/[\r\n]+/g, " ").trim() || "Stream";
  return `#EXTM3U\n#EXTINF:-1,${name}\n${withoutHash(url)}\n`;
}

export function playlistFileName(title?: string): string {
  const base = String(title || "stream")
    .normalize("NFKD")
    .replace(/[^\w\s.-]+/g, "")
    .trim()
    .replace(/\s+/g, ".")
    .slice(0, 80);
  return `${base || "stream"}.m3u`;
}

/** The playlist file a computer saves to start its own player. */
function playlistFile(url: string, title?: string): NonNullable<ExternalPlayerOption["file"]> {
  return { fileName: playlistFileName(title), mimeType: "audio/x-mpegurl", content: m3uPlaylist(url, title) };
}

/** Android intent that only VLC answers (the Play Store when VLC isn't installed). */
function androidVlcUrl(url: string, title?: string): string {
  return androidIntentUrl(url, {
    packageName: VLC_ANDROID_PACKAGE,
    title,
    browserFallbackUrl: `${PLAY_STORE}${VLC_ANDROID_PACKAGE}`,
  });
}

/** VLC for iOS' x-callback-url stream scheme. */
function iosVlcUrl(url: string): string {
  return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(withoutHash(url))}`;
}

/** Ordered external-player options for this platform. "Copy URL" is added by the UI. */
export function externalPlayerOptions(
  url: string,
  options: { title?: string; platform: ClientPlatform }
): ExternalPlayerOption[] {
  const { title, platform } = options;
  if (!isDirectMediaUrl(url)) return [];

  const playlist: ExternalPlayerOption = {
    id: "m3u",
    label: "Desktop player (.m3u)",
    file: playlistFile(url, title),
    note: "Opens in VLC, IINA, mpv or your default player.",
  };

  if (platform === "android") {
    return [
      { id: "vlc", label: "VLC", href: androidVlcUrl(url, title) },
      {
        id: "mx",
        label: "MX Player",
        href: androidIntentUrl(url, {
          packageName: "com.mxtech.videoplayer.ad",
          title,
          browserFallbackUrl: `${PLAY_STORE}com.mxtech.videoplayer.ad`,
        }),
      },
      { id: "android-chooser", label: "Other app", href: androidIntentUrl(url, { title }) },
    ];
  }

  if (platform === "ios") {
    const encoded = encodeURIComponent(withoutHash(url));
    return [
      { id: "vlc", label: "VLC", href: iosVlcUrl(url) },
      { id: "infuse", label: "Infuse", href: `infuse://x-callback-url/play?url=${encoded}` },
    ];
  }

  if (platform === "mac") {
    return [
      { id: "iina", label: "IINA", href: `iina://weblink?url=${encodeURIComponent(withoutHash(url))}` },
      playlist,
    ];
  }

  return [playlist];
}

/* ------------------------- direct "Play in VLC" plan ----------------------- */

export interface VlcLaunchPlan {
  /** `app` opens the VLC app through a real `<a href>`, `playlist` saves an `.m3u` file for it. */
  mode: "app" | "playlist";
  /** App link — Android `intent:` / iOS `vlc-x-callback:`. Rendered directly as `<a href>`. */
  href?: string;
  /** `.m3u` to save and open in desktop VLC. Only in `playlist` mode. */
  file?: NonNullable<ExternalPlayerOption["file"]>;
  /** One line telling the user what happens next. */
  note: string;
}

/**
 * How to launch VLC for an ALREADY-RESOLVED direct HTTPS stream URL on this device.
 * Phones get VLC's own app scheme (`intent:` on Android, `vlc-x-callback:` on iOS) so
 * rendering it inside `<a href={plan.href}>` opens VLC directly inside the user's tap;
 * computers get a one-entry `.m3u` playlist file that opens in VLC.
 */
export function vlcLaunchPlan(url: string, options: { title?: string; platform: ClientPlatform }): VlcLaunchPlan | null {
  const { title, platform } = options;
  if (!isDirectMediaUrl(url)) return null;

  if (platform === "android") {
    return { mode: "app", href: androidVlcUrl(url, title), note: "Opens and streams directly in VLC." };
  }
  if (platform === "ios") {
    return { mode: "app", href: iosVlcUrl(url), note: "Opens and streams directly in VLC." };
  }
  const file = playlistFile(url, title);
  return { mode: "playlist", file, note: `Saved ${file.fileName} — open it to play in VLC.` };
}

/* ------------------------ a link worth handing over ------------------------ */

/**
 * Whether a URL may be handed to a player app at all: plain HTTPS and no embedded
 * credentials. Every link is checked against this before a VLC button acts on it, so a
 * malformed or hostile resolve response can never become a navigation.
 */
export function isDirectMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
