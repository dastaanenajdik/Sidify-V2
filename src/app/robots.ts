import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  const disallowPrivate = [
    "/api/",
    "/dev/",
    "/get",
    "/settings",
    "/downloads",
    "/library/",
  ];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: disallowPrivate,
      },
      {
        userAgent: ["Googlebot", "Googlebot-Image", "Bingbot"],
        allow: [
          "/",
          "/search",
          "/explore",
          "/rooms",
          "/app",
          "/movies",
          "/series",
          "/exclusive",
          "/album/",
          "/artist/",
        ],
        disallow: disallowPrivate,
      },
    ],
    host: siteUrl,
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
