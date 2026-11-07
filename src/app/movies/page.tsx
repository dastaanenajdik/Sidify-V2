import type { Metadata } from "next";
import MediaBrowsePage from "@/components/media/MediaBrowsePage";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Movies",
  description:
    "Browse trending films and new releases, stream free public-domain classics in the built-in player, filter by genre, year and language, and build a watchlist.",
  alternates: { canonical: "/movies" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Movies · Sidify",
    description: "Trending films, free classics, and a watchlist — filtered by genre, year and language.",
    url: "/movies",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function MoviesPage() {
  return <MediaBrowsePage kind="movie" />;
}
