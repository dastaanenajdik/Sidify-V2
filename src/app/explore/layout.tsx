import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Explore Music Genres, Moods & Trending Songs",
  description:
    "Explore trending songs, new music releases, Bollywood hits, Punjabi songs, Pop, Hip-Hop, Lo-Fi beats, Workout, Chill and Romance mixes free on Sidify.",
  keywords: [
    "explore music",
    "music genres",
    "mood playlists",
    "trending songs",
    "Bollywood songs",
    "Punjabi music",
    "Lo-Fi beats",
    "Sidify explore",
  ],
  alternates: { canonical: "/explore" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Explore Music Genres, Moods & Trending Songs · Sidify",
    description:
      "Browse 26+ music moods and genres — Bollywood, Punjabi, Pop, Hip-Hop, Lo-Fi, Workout & more on Sidify.",
    url: "/explore",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
