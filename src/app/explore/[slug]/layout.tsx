import type { Metadata } from "next";
import type { ReactNode } from "react";
import JsonLd from "@/components/JsonLd";
import { MOODS, moodBySlug } from "@/lib/explore";
import { DEFAULT_OG_IMAGE, SITE_NAME, buildMoodJsonLd } from "@/lib/seo";

type Props = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return MOODS.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const mood = moodBySlug(slug);
  if (!mood) {
    return {
      title: { absolute: "Explore Music · Sidify" },
      alternates: { canonical: "/explore" },
    };
  }

  const label = mood.kind === "mood" ? "Mood Playlist" : "Genre";
  const title = `${mood.title} Songs & Music — Stream Free · Sidify`;
  const description = `Listen to the best ${mood.q} and ${mood.title.toLowerCase()} music free on Sidify. Stream full songs ad-free with synced lyrics, playlists, albums and smart song radio.`;

  return {
    title: { absolute: title },
    description,
    keywords: [
      mood.title,
      mood.q,
      `${mood.title} songs`,
      `${mood.title} music`,
      `free ${mood.title.toLowerCase()} songs`,
      `${mood.title} playlist`,
      "Sidify",
      "free music streaming",
    ],
    alternates: { canonical: `/explore/${mood.slug}` },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: `${mood.title} Songs & Music (${label}) · Sidify`,
      description,
      url: `/explore/${mood.slug}`,
      images: mood.art ? [{ url: mood.art }] : [DEFAULT_OG_IMAGE],
    },
  };
}

export default async function MoodLayout({ children, params }: Props) {
  const { slug } = await params;
  const mood = moodBySlug(slug);
  return (
    <>
      {mood ? <JsonLd data={buildMoodJsonLd(mood)} /> : null}
      {children}
    </>
  );
}
