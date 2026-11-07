import type { Metadata } from "next";
import type { ReactNode } from "react";
import JsonLd from "@/components/JsonLd";
import { ANDROID_APP, APP_SIZE_LABEL } from "@/lib/appRelease";
import { DEFAULT_OG_IMAGE, SITE_NAME, buildAndroidAppJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: `Download Official Android App ${ANDROID_APP.tag} (Free Music APK)`,
  description: `Get the official Sidify Android music app: background song playback, 5-band studio equalizer with saved presets, synced lyrics and offline song downloads. Free ${APP_SIZE_LABEL} APK, no account or ads.`,
  keywords: [
    "Sidify app",
    "Sidify APK",
    "Sidify download",
    "free music app Android",
    "offline song player APK",
    "free Spotify alternative APK",
    "ad-free music player app",
  ],
  alternates: { canonical: "/app" },
  openGraph: {
    siteName: SITE_NAME,
    title: `Sidify App ${ANDROID_APP.tag} — Free Music Player APK`,
    description: `Background playback, studio equalizer, synced lyrics and offline song downloads. Free Android APK (${APP_SIZE_LABEL}).`,
    type: "website",
    url: "/app",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={buildAndroidAppJsonLd()} />
      {children}
    </>
  );
}
