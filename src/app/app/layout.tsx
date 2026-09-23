import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ANDROID_APP, APP_SIZE_LABEL } from "@/lib/appRelease";

export const metadata: Metadata = {
  title: `Download the Sidify app — ${ANDROID_APP.name} ${ANDROID_APP.tag} (APK)`,
  description:
    `Get the Sidify Android app: background playback, a real studio equalizer, 8D spatial audio and offline downloads. Free ${APP_SIZE_LABEL} APK, no account needed.`,
  openGraph: {
    title: `Sidify app ${ANDROID_APP.tag} — download the APK`,
    description:
      `Background playback, studio equalizer, 8D spatial audio and offline downloads. Free Android APK, ${APP_SIZE_LABEL}.`,
    type: "website",
  },
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return children;
}
