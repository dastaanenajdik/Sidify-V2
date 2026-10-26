import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ExclusiveDetailPage from "@/components/media/ExclusiveDetailPage";
import MediaDetailView from "@/components/media/MediaDetailView";
import { getMediaDetail } from "@/lib/media/service";
import { isVaultSlug, titleFromVaultSlug } from "@/lib/media/vaultAdapt";

/**
 * Never serve a cached copy of this page.
 *
 * The exclusive catalogue's pages are a frame whose payload is fetched by the
 * browser, so there is nothing worth caching — and caching them is actively
 * harmful: a page rendered by an older deploy kept being served (for up to
 * `revalidate` seconds) after the client-side player shipped, which is exactly
 * the "no play button" that was reported. Metadata fetches keep their own
 * `revalidate` (see the providers), so nothing else loses its cache.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

type Props = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) => {
  return getMediaDetail("series", decodeURIComponent(slug));
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
      alternates: { canonical: `/series/${decodeURIComponent(slug)}` },
      openGraph: { type: "video.movie", title: name, description: `${name} on Sidify.`, url: `/series/${decodeURIComponent(slug)}` },
    };
  }

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

  // Server-rendered frame, browser-fetched payload: the exclusive catalogue is
  // unreachable from serverless egress, so its pages resolve client-side.
  if (isVaultSlug(decodeURIComponent(slug))) {
    const clean = decodeURIComponent(slug);
    return <ExclusiveDetailPage slug={clean} kind="series" fallbackTitle={titleFromVaultSlug(clean)} />;
  }
  const detail = await load(slug);
  if (!detail) notFound();
  return <MediaDetailView detail={detail} />;
}
