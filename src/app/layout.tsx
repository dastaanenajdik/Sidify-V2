import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Providers from "@/components/Providers";
import AppShell from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: { default: "Sidify", template: "%s · Sidify" },
  description:
    "Sidify — stream full songs, follow synced lyrics, let AutoPlay pick what comes next and listen together with friends in real time.",
  manifest: "/manifest.json",
  icons: [
    { rel: "icon", url: "/icon.png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
  appleWebApp: { title: "Sidify", statusBarStyle: "black-translucent", capable: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark">
      <head>
        {/* Warm the Sidify player + artwork hosts so the first song starts sooner.
            Artwork <img>s load straight from the YouTube/Google image CDNs, so
            opening those connections during HTML parse (before the client even
            knows which covers it needs) takes a full DNS+TLS round-trip off the
            first posters on slow networks. */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://www.google.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://lh3.googleusercontent.com" />
        <link rel="dns-prefetch" href="https://www.gstatic.com" />
      </head>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
