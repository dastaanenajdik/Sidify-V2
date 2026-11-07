import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const canonical = `/artist/${encodeURIComponent(decodedId)}`;

  return {
    title: "Artist — Top Songs, Albums & Music Radio",
    description:
      "Stream top songs, full albums, singles and artist radio free on Sidify with synced lyrics and ad-free music playback.",
    alternates: { canonical },
    openGraph: {
      type: "profile",
      siteName: SITE_NAME,
      title: "Artist — Top Songs, Albums & Music Radio · Sidify",
      description:
        "Listen to top artist songs, albums and personalized music radio free on Sidify.",
      url: canonical,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export default function ArtistLayout({ children }: { children: ReactNode }) {
  return children;
}
