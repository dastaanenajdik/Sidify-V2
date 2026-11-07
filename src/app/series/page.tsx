import type { Metadata } from "next";
import MediaBrowsePage from "@/components/media/MediaBrowsePage";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Series",
  description:
    "Browse trending series and new seasons, filter by genre, year and language, and read season and episode details — Sidify's series shelf, using licensed metadata only.",
  alternates: { canonical: "/series" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Series · Sidify",
    description: "Trending series, new seasons, episode guides and a watchlist.",
    url: "/series",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function SeriesPage() {
  return <MediaBrowsePage kind="series" />;
}
