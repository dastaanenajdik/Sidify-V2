/**
 * Single source of truth for the Android app release.
 *
 * Every surface that talks about the app — the home banner, the sidebar promo, the
 * /app landing page — reads from here, so shipping a new build only means editing
 * this one file (and pointing `apkUrl` at the new asset).
 */

import { formatBytes } from "./format";

export const ANDROID_APP = {
  /** Marketing name shown to users. */
  name: "IfallMusic",
  /** What we call it on this site. */
  siteName: "Sidify app",
  version: "2.2.0",
  tag: "v2.2.0",
  released: "23 Sept 2026",
  /** Exact byte size of the asset in the GitHub release. */
  sizeBytes: 62_755_455,
  fileName: "app-release.apk",
  platform: "Android phone & tablet",
  price: "Free",
  author: "Siddharth · ifallertzia",
  apkUrl:
    "https://github.com/ifallertzia/Saxify-v1/releases/download/v2.2.0/app-release.apk",
  releaseUrl: "https://github.com/ifallertzia/Saxify-v1/releases/latest",
  repoUrl: "https://github.com/ifallertzia/Saxify-v1",
} as const;

/** Human label for the asset size — derived with the site's own formatter. */
export const APP_SIZE_LABEL = formatBytes(ANDROID_APP.sizeBytes); // → "59.8 MB"

export type AppFeature = {
  icon: string;
  title: string;
  desc: string;
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
    desc: "Five genuine Android audio-session bands with Bass Boost, Rock, Treble, Vocal and your own curve.",
  },
  {
    icon: "orbit",
    title: "8D spatial audio",
    desc: "Seven ready-made spatial templates with orbit speed, depth and reverb sliders — plus a live orbit meter.",
  },
  {
    icon: "download",
    title: "Offline downloads",
    desc: "Songs save to Download/IfallMusic with a private offline copy, so they play with zero internet.",
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

/** Condensed from the v2.2.0 release notes on GitHub. */
export const APP_WHATS_NEW: string[] = [
  "The app is now IfallMusic — a new wordmark, new icon, new notification channel and a new download folder.",
  "Liquid-glass redesign on true black: every panel, sheet and row is frosted glass with deep vivid accents.",
  "18 accents plus your own RGB mix, and an auto-rotating theme you can set to 1 / 2 / 2.5 / 3 / 5 minutes.",
  "Library opens with its tabs in front of you — Liked, Playlists, Songs, Artists, Downloads, History — with live counters.",
  "Download percentages now show on song rows, in the Downloads tab and in the mini-player.",
  "8D spatial audio, a brand-new template: seven spatial presets, orbit speed, depth and reverb sliders.",
  "Equalizer rebuilt in glass, with real Android audio-session bands and its own presets.",
  "A Sound panel in the player — volume, the equalizer link and the 8D templates sit one tap from speed, sleep timer and queue.",
  "Top artists show real faces again, and “Play today’s mix” fits every phone.",
  "Contact / Report fixed, so the email draft arrives without stray “+” signs.",
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
