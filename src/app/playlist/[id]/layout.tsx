import type { Metadata } from "next";
import type { ReactNode } from "react";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const canonical = `/playlist/${encodeURIComponent(decodeURIComponent(id))}`;
  return {
    title: "Playlist",
    description: "Listen to custom music playlists on Sidify.",
    alternates: { canonical },
    robots: { index: false, follow: true },
  };
}

export default function PlaylistLayout({ children }: { children: ReactNode }) {
  return children;
}
