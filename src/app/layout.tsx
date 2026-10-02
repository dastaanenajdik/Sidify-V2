import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import Providers from "@/components/Providers";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora" });

export const metadata: Metadata = {
  title: "Sidify — Stream Beyond Limits",
  description:
    "Sidify is a premium neon music streaming experience: instant YouTube search, full-length playback, smart downloads and a zero-lag interface.",
  manifest: "/manifest.json",
  icons: [
    { rel: "icon", url: "/icon.png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
  appleWebApp: { title: "Sidify", statusBarStyle: "black-translucent", capable: true },
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="dark">
      <body className={`${inter.variable} ${sora.variable} text-[var(--text)] antialiased`}>
        <Providers>
          <div className="relative flex h-dvh overflow-hidden">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="relative min-w-0 flex-1 overflow-y-auto pb-[168px] md:pb-[104px]">{children}</main>
              <div id="player-slot" className="hidden md:block" />
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
