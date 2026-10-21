import type { Metadata } from "next";
import MediaBrowsePage from "@/components/media/MediaBrowsePage";

export const metadata: Metadata = {
  title: "Series",
  description:
    "Browse trending series and new seasons, filter by genre, year and language, and read season and episode details — Sidify's series shelf, using licensed metadata only.",
  alternates: { canonical: "/series" },
  openGraph: {
    title: "Series · Sidify",
    description: "Trending series, new seasons, episode guides and a watchlist.",
    url: "/series",
  },
};

export default function SeriesPage() {
  return <MediaBrowsePage kind="series" />;
}
