import type { Metadata } from "next";
import MediaBrowsePage from "@/components/media/MediaBrowsePage";

export const metadata: Metadata = {
  title: "Movies",
  description:
    "Browse trending films and new releases, stream free public-domain classics in the built-in player, filter by genre, year and language, and build a watchlist.",
  alternates: { canonical: "/movies" },
  openGraph: {
    title: "Movies · Sidify",
    description: "Trending films, free classics, and a watchlist — filtered by genre, year and language.",
    url: "/movies",
  },
};

export default function MoviesPage() {
  return <MediaBrowsePage kind="movie" />;
}
