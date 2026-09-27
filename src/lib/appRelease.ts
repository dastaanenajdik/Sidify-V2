/**
 * Single source of truth for the Android app release.
 *
 * Every surface that talks about the app — the home banner, the sidebar promo, the
 * /app landing page, the `/get` short link and its QR code — reads from here, so
 * shipping a new build only means editing this one file. `apkUrl` points at the
 * release's `latest` asset, so the link itself never goes stale.
 */

export const ANDROID_APP = {
  /** Marketing name shown to users. */
  name: "IfallMusic",
  /** What we call it on this site. */
  siteName: "Sidify app",
  version: "2.3.3",
  tag: "v2.3.3",
  released: "27 Sept 2026",
  /** Exact byte size of the asset in the GitHub release. */
  sizeBytes: 72_511_067,
  fileName: "app-release.apk",
  platform: "Android",
  price: "Free",
  author: "Siddharth · ifallertzia",
  /**
   * The `latest` asset URL — it carries no version, so the download button, the QR
   * code and the `/get` short link keep serving the newest build even after the next
   * release ships. Only the version/size/notes below need editing per release.
   */
  apkUrl:
    "https://github.com/ifallertzia/Saxify-v1/releases/latest/download/app-release.apk",
  releaseUrl: "https://github.com/ifallertzia/Saxify-v1/releases/latest",
  repoUrl: "https://github.com/ifallertzia/Saxify-v1",
} as const;

/**
 * Human label for the asset size.
 *
 * The release notes quote the APK in decimal megabytes (72.5 MB), so this uses the
 * same unit instead of the site's binary `formatBytes`, which would print 69.2 MB for
 * the very same file.
 */
export const APP_SIZE_LABEL = `${(ANDROID_APP.sizeBytes / 1_000_000).toFixed(1)} MB`; // → "72.5 MB"

export type AppFeature = {
  icon: string;
  title: string;
  desc: string;
  /** Announced but not in this build yet — the card gets a "Coming soon" pill. */
  soon?: boolean;
};

/** The pitch — big, concrete promises, one line of proof each. */
export const APP_FEATURES: AppFeature[] = [
  {
    icon: "moon-star",
    title: "Background playback",
    desc: "Lock the screen, switch apps or pocket the phone — the music never stops.",
  },
  {
    icon: "sliders-horizontal",
    title: "Real studio equalizer",
    desc: "Five genuine Android audio-session bands with Bass Boost, Rock, Treble and Vocal — plus custom presets you can save, and it opens straight from the player.",
  },
  {
    icon: "orbit",
    title: "8D spatial audio",
    desc: "Orbit speed, depth and reverb templates are still in the works — not part of this build. They land in a coming release.",
    soon: true,
  },
  {
    icon: "download",
    title: "Offline downloads",
    desc: "Songs save to Download/IfallMusic with a private offline copy, and the player shows live progress and percentage next to the Like button.",
  },
  {
    icon: "mic-vocal",
    title: "Synced lyrics",
    desc: "The current line is followed automatically as the song plays — tap any line to seek the track to that exact point.",
  },
  {
    icon: "wrap-text",
    title: "Compact lyrics view",
    desc: "Less gap between lines, with proper room left for big and wrapped text, so more of the lyric fits on one screen.",
  },
  {
    icon: "list-music",
    title: "Playlists & library",
    desc: "Liked songs, playlists, artists, downloads and history — big colourful tabs with live counters.",
  },
  {
    icon: "sparkles",
    title: "18 accents + RGB mixer",
    desc: "Paint the whole app in your own colour, or let the theme rotate itself every few minutes.",
  },
  {
    icon: "timer",
    title: "Queue, crossfade, sleep timer",
    desc: "Gapless queue, autoplay, playback speed and a sleep timer that fades you out.",
  },
  {
    icon: "shield-check",
    title: "Free, no account",
    desc: `No subscription, no sign-in, no ads. One ${APP_SIZE_LABEL} APK and it is yours.`,
  },
];

/** Condensed from the v2.3.3 release notes on GitHub. */
export const APP_WHATS_NEW: string[] = [
  "Compact lyrics — less gap between the lines, with proper space left for big and wrapped text.",
  "Synced lyrics — the current line is followed automatically, and tapping a line seeks the song to that point.",
  "Download progress in the player — the percentage now sits right next to the Like button.",
  "Saved equalizer presets — save your own curves, and your selected settings stay put when the track changes.",
  "Quick equalizer access — open the equalizer directly from the player.",
  "Latest download shortcut — Settings opens the website and the latest app download link.",
];

/**
 * Announced, not shipped. Rendered as a note beside the release notes so nobody
 * goes hunting for a feature this build does not have.
 */
export const APP_COMING_SOON: string[] = [
  `8D audio is coming soon — it is not available in ${ANDROID_APP.tag}. It arrives in a later build.`,
];

export type InstallStep = { title: string; desc: string };

export const INSTALL_STEPS: InstallStep[] = [
  {
    title: "Download the APK",
    desc: `Tap the download button. The ${APP_SIZE_LABEL} file lands in your phone\u2019s Downloads folder — keep this page open while it finishes.`,
  },
  {
    title: "Open the file",
    desc: "Pull down the notification panel and tap the finished download, or open Files → Downloads → app-release.apk.",
  },
  {
    title: "Allow the install",
    desc: "Android may ask to allow installs from this source. Tap Settings → turn on “Allow from this source” → come back.",
  },
  {
    title: "Install and open",
    desc: "Tap Install, then Open. If Play Protect warns about an unknown app, choose “Install anyway” — nothing else is needed.",
  },
];

export type Faq = { q: string; a: string };

export const APP_FAQ: Faq[] = [
  {
    q: "Is the app free?",
    a: "Yes. The APK is free to download and free to use — no account, no subscription and no ads. You only need the file below.",
  },
  {
    q: "Why does Android warn me before installing?",
    a: "The APK is not distributed through the Play Store, so Play Protect marks it as an unknown app. Tap “Install anyway” — the file comes straight from the official GitHub release page of this project.",
  },
  {
    q: "How do I update to a newer version?",
    a: "Come back to this page and download the newest APK. Installing it over the old version keeps your songs, likes and playlists. The app also checks GitHub for updates when it opens.",
  },
  {
    q: "Will my playlists and liked songs carry over?",
    a: "The app keeps its own library on the phone. Both the app and this website can export a JSON backup (Settings → Library backup), so you can move your playlists from one to the other.",
  },
  {
    q: "Which Android versions work?",
    a: "Modern Android phones and tablets. If the installer says “App not installed”, uninstall any older Sidify / Saxify build first and try again.",
  },
  {
    q: "Do I still need this website after installing?",
    a: "No. The app is standalone — playback, background audio, downloads and the equalizer all run on the device. The website stays here as the browser version, which keeps working exactly as before.",
  },
];

/** Detail rows for the spec table. */
export const APP_SPECS: { label: string; value: string }[] = [
  { label: "App name", value: ANDROID_APP.name },
  { label: "Version", value: `${ANDROID_APP.version} (latest)` },
  { label: "Released", value: ANDROID_APP.released },
  { label: "File", value: ANDROID_APP.fileName },
  { label: "Size", value: APP_SIZE_LABEL },
  { label: "Platform", value: ANDROID_APP.platform },
  { label: "Price", value: ANDROID_APP.price },
  { label: "Built by", value: ANDROID_APP.author },
];
