import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MediaDetailView from "@/components/media/MediaDetailView";
import { getMediaDetail } from "@/lib/media/service";

/** Re-render at most hourly; the provider caches its own metadata too. */
export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) => {
  return getMediaDetail("movie", decodeURIComponent(slug));
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await load(slug).catch(() => null);
  if (!detail) return { title: "Film not found" };
  const { title } = detail;
  const description = title.overview?.slice(0, 155) || `${title.title}${title.year ? ` (${title.year})` : ""} on Sidify.`;
  return {
    title: `${title.title}${title.year ? ` (${title.year})` : ""}`,
    description,
    alternates: { canonical: `/movies/${title.slug}` },
    openGraph: {
      type: "video.movie",
      title: title.title,
      description,
      url: `/movies/${title.slug}`,
      images: title.poster ? [{ url: title.poster }] : undefined,
    },
  };
}

export default async function MovieDetailPage({ params }: Props) {
  const { slug } = await params;
  const detail = await load(slug);
  if (!detail) notFound();
  return <MediaDetailView detail={detail} />;
}
