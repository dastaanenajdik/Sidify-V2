/**
 * "Open in VLC / MX Player" links — platform-specific and strictly best-effort.
 *
 * External players stream the same direct HTTPS URL the browser would download (with
 * seeking, every codec, audio-track switching and subtitles), so they are the manual
 * fallback when in-browser playback shows a black screen or has no sound. Nothing here
 * contacts the media host; the user's own device opens the URL. Whether a link works
 * depends on which apps are installed, so the UI always keeps "Copy URL" next to them.
 */

export type ClientPlatform = "android" | "ios" | "mac" | "desktop";

export interface PlatformEnv {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

/** Coarse platform from the user agent. iPadOS desktop-mode UAs count as iOS. */
export function detectClientPlatform(env: PlatformEnv | null | undefined): ClientPlatform {
  const ua = env?.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  const touch = (env?.maxTouchPoints ?? 0) > 1;
  if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(env?.platform || "")) return touch ? "ios" : "mac";
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

/** Ordered external-player options for this platform. "Copy URL" is added by the UI. */
export function externalPlayerOptions(
  url: string,
  options: { title?: string; platform: ClientPlatform }
): ExternalPlayerOption[] {
  const { title, platform } = options;
  if (!/^https:\/\//i.test(url)) return [];

  const playlist: ExternalPlayerOption = {
    id: "m3u",
    label: "Desktop player (.m3u)",
    file: { fileName: playlistFileName(title), mimeType: "audio/x-mpegurl", content: m3uPlaylist(url, title) },
    note: "Opens in VLC, IINA, mpv or your default player.",
  };

  if (platform === "android") {
    return [
      {
        id: "vlc",
        label: "VLC",
        href: androidIntentUrl(url, { packageName: "org.videolan.vlc", title, browserFallbackUrl: `${PLAY_STORE}org.videolan.vlc` }),
      },
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
      { id: "vlc", label: "VLC", href: `vlc-x-callback://x-callback-url/stream?url=${encoded}` },
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
