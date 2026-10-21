import type { Metadata } from "next";
import MediaBrowsePage from "@/components/media/MediaBrowsePage";

export const metadata: Metadata = {
  title: "Movies",
  description:
    "Browse trending films and new releases, filter by genre, year and language, and build a watchlist — Sidify's movies shelf, using licensed metadata only.",
  alternates: { canonical: "/movies" },
  openGraph: {
    title: "Movies · Sidify",
    description: "Trending films, new releases and a watchlist — filtered by genre, year and language.",
    url: "/movies",
  },
};

export default function MoviesPage() {
  return <MediaBrowsePage kind="movie" />;
}
