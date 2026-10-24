import type { Metadata } from "next";
import { ExclusiveSection } from "@/components/media/ExclusiveSection";

export const metadata: Metadata = {
  title: "Exclusive",
  description:
    "The exclusive collection: its own search, its own titles, each with full details, streams and downloads.",
  alternates: { canonical: "/exclusive" },
  openGraph: {
    title: "Exclusive · Sidify",
    description: "A separate collection of films and series, searched on its own.",
    url: "/exclusive",
  },
};

export default function ExclusivePage() {
  return <ExclusiveSection />;
}
