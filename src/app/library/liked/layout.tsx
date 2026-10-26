import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Metadata-only layout: the page below is a client component, which cannot
 * export `metadata`, so the route title lives here instead (same pattern as
 * `src/app/app/layout.tsx`). The root layout's `%s · Sidify` template applies.
 */
export const metadata: Metadata = {
  title: { absolute: "Liked Songs · Sidify" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
