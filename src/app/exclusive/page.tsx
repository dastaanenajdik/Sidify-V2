import type { Metadata } from "next";
import { ExclusiveSection } from "@/components/media/ExclusiveSection";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Exclusive",
  description:
    "The exclusive collection: its own search, its own titles, each with full details, streams and downloads.",
  alternates: { canonical: "/exclusive" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Exclusive · Sidify",
    description: "A separate collection of films and series, searched on its own.",
    url: "/exclusive",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function ExclusivePage() {
  return <ExclusiveSection />;
}
