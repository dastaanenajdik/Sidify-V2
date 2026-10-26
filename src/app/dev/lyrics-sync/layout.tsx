import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * The synced-lyrics playground under this route is a developer tool (see the
 * note at the top of `page.tsx`): it ships with the production build so the
 * exact shipping lyrics code can be inspected live, but it is not a product
 * page, so keep search engines out of it.
 */
export const metadata: Metadata = {
  title: "Lyrics Sync Playground (dev)",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
