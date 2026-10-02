import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["youtubei.js"],
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
