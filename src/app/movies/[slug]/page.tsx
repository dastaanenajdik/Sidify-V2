import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ExclusiveDetailPage from "@/components/media/ExclusiveDetailPage";
import MediaDetailView from "@/components/media/MediaDetailView";
import { getMediaDetail } from "@/lib/media/service";
import { isVaultSlug, titleFromVaultSlug } from "@/lib/media/vaultAdapt";

/** Re-render at most hourly; the provider caches its own metadata too. */
export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) => {
  return getMediaDetail("movie", decodeURIComponent(slug));
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  // An exclusive title must not cost the server a catalogue call: its page is
  // fetched by the browser (see ExclusiveDetailPage), so its metadata comes from
  // the slug alone.
  if (isVaultSlug(decodeURIComponent(slug))) {
    const name = titleFromVaultSlug(decodeURIComponent(slug));
    return {
      title: `${name}`,
      description: `${name} on Sidify.`,
      alternates: { canonical: `/movies/${decodeURIComponent(slug)}` },
      openGraph: { type: "video.movie", title: name, description: `${name} on Sidify.`, url: `/movies/${decodeURIComponent(slug)}` },
    };
  }

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

  // Server-rendered frame, browser-fetched payload: the exclusive catalogue is
  // unreachable from serverless egress, so its pages resolve client-side.
  if (isVaultSlug(decodeURIComponent(slug))) {
    const clean = decodeURIComponent(slug);
    return <ExclusiveDetailPage slug={clean} kind="movie" fallbackTitle={titleFromVaultSlug(clean)} />;
  }
  const detail = await load(slug);
  if (!detail) notFound();
  return <MediaDetailView detail={detail} />;
}
