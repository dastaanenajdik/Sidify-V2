import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MediaDetailView from "@/components/media/MediaDetailView";
import { getMediaDetail } from "@/lib/media/service";

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) => {
  return getMediaDetail("series", decodeURIComponent(slug));
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const detail = await load(slug).catch(() => null);
  if (!detail) return { title: "Series not found" };
  const { title } = detail;
  const description = title.overview?.slice(0, 155) || `${title.title}${title.year ? ` (${title.year})` : ""} on Sidify.`;
  return {
    title: `${title.title}${title.year ? ` (${title.year})` : ""}`,
    description,
    alternates: { canonical: `/series/${title.slug}` },
    openGraph: {
      type: "video.tv_show",
      title: title.title,
      description,
      url: `/series/${title.slug}`,
      images: title.poster ? [{ url: title.poster }] : undefined,
    },
  };
}

export default async function SeriesDetailPage({ params }: Props) {
  const { slug } = await params;
  const detail = await load(slug);
  if (!detail) notFound();
  return <MediaDetailView detail={detail} />;
}
