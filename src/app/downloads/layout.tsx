import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Downloads",
  description: "Offline songs saved to your device on Sidify.",
  alternates: { canonical: "/downloads" },
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
