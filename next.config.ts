import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["youtubei.js"],
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  // Movies & series artwork. Cards draw generated SVG art when a title has no poster,
  // but the providers' CDNs have to be allow-listed for next/image consumers:
  // TMDb posters, YouTube stills and Internet Archive item thumbnails.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "catimages.org" },
      { protocol: "https", hostname: "*.catimages.org" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "archive.org" },
      { protocol: "https", hostname: "*.archive.org" },
    ],
  },
  // Expose the Vercel commit SHA to the client so Settings → About can show which build a
  // device is actually running (useful when a cached PWA shell keeps serving an old release).
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  // Dev-only: the sandbox preview proxies dev traffic from `*.e2b.app`, and Next blocks
  // cross-origin dev requests (HMR + client chunks) unless the host is allowed here.
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
      {
        // PWA/app icons and local cover art change only with a release. Next
        // serves `public/` with `max-age=0` by default, so repeat visits
        // revalidated (and on flaky networks re-downloaded) every icon and
        // cover on every load. A week of browser caching with a day of
        // stale-while-revalidate makes repeat loads instant while a changed
        // icon still rolls out within days.
        source: "/:file(icon.*\\.png|favicon\\.ico)",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/covers/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
