import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { absolute: "Listening Room · Sidify" },
  description: "Join a live Listen Together room on Sidify to stream music in sync with friends.",
  alternates: { canonical: "/rooms" },
  robots: { index: false, follow: false },
};

export default function RoomCodeLayout({ children }: { children: ReactNode }) {
  return children;
}
