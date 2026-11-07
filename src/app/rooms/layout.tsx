import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Listen Together — Stream Music & Songs With Friends Live",
  description:
    "Start a free Listen Together room on Sidify, share a room code, and listen to the same song at the exact same moment with live chat, voice and video calls.",
  keywords: [
    "listen together",
    "music rooms",
    "listen to songs with friends",
    "Spotify Jam alternative",
    "sync music online",
    "Sidify rooms",
  ],
  alternates: { canonical: "/rooms" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Listen Together — Live Music Rooms · Sidify",
    description:
      "Start a room, share the code, and hear the exact same song together in real time on Sidify.",
    url: "/rooms",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
