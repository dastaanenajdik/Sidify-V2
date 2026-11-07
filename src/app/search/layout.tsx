import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Search Songs, Music, Artists, Albums & Movies",
  description:
    "Search millions of full songs, music albums, artists, synced lyrics, playlists, and HD movies & series free on Sidify.",
  keywords: [
    "search songs",
    "search music",
    "find song online",
    "free song search",
    "Sidify search",
    "stream music online",
    "Spotify song search alternative",
  ],
  alternates: { canonical: "/search" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Search Songs, Music, Artists & Movies · Sidify",
    description:
      "Instantly find and play any song, album, artist, playlist or movie free on Sidify.",
    url: "/search",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
