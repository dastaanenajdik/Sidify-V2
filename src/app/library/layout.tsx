import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Library",
  description: "Your liked songs, custom playlists, followed artists and listening history on Sidify.",
  alternates: { canonical: "/library" },
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
