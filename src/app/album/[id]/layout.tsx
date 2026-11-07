import type { Metadata } from "next";
import type { ReactNode } from "react";
import { decodePseudoAlbum } from "@/lib/parser";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const pseudo = decodePseudoAlbum(decodedId);

  const title = pseudo?.t
    ? `${pseudo.t}${pseudo.a ? ` — ${pseudo.a}` : ""}`
    : "Music Album — Stream Full Songs Free";
  const description = pseudo?.t
    ? `Stream ${pseudo.t}${pseudo.a ? ` by ${pseudo.a}` : ""} free on Sidify with full songs, synced lyrics and offline download.`
    : "Listen to full album songs ad-free on Sidify with real-time synced lyrics, AutoPlay song radio and offline downloads.";
  const canonical = `/album/${encodeURIComponent(decodedId)}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "music.album",
      siteName: SITE_NAME,
      title: `${title} · Sidify`,
      description,
      url: canonical,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export default function AlbumLayout({ children }: { children: ReactNode }) {
  return children;
}
