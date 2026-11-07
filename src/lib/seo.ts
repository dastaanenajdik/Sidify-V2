import { ANDROID_APP, APP_FAQ, APP_SIZE_LABEL } from "@/lib/appRelease";
import type { Mood } from "@/lib/explore";

/** Canonical production origin for Sidify when no env override is provided. */
export const DEFAULT_SITE_URL = "https://sidify.vercel.app";

export const SITE_NAME = "Sidify";

export const SITE_TITLE = "Sidify — Free Music & Song Streaming Player | Listen Online";

export const SITE_DESCRIPTION =
  "Sidify is a free online music and song streaming player. Stream full songs ad-free, follow real-time synced lyrics, enjoy Spotify-style mixes and song radio, listen together with friends, download songs offline, and watch HD movies & series.";

export const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Sidify — Free Music & Song Streaming Player",
} as const;

/**
 * Primary search keywords targeting brand ("Sidify"), category ("music", "song", "songs"),
 * and streaming-platform discovery ("Spotify", "free music streaming", "online music player").
 */
export const SEO_KEYWORDS: string[] = [
  "Sidify",
  "Sidify music",
  "Sidify player",
  "Sidify V2",
  "Sidify web player",
  "Sidify app",
  "Sidify APK",
  "music",
  "song",
  "songs",
  "free music",
  "free songs",
  "free music streaming",
  "online music player",
  "stream songs online",
  "play full songs free",
  "music streaming site",
  "ad-free music player",
  "Spotify",
  "Spotify alternative",
  "free Spotify web player alternative",
  "music app like Spotify",
  "synced lyrics",
  "song lyrics",
  "listen together",
  "music rooms",
  "song radio",
  "download songs offline",
  "Bollywood songs",
  "Hindi songs",
  "Punjabi songs",
  "Lo-Fi music",
  "English pop songs",
  "free movies and music",
];

function normalizeOrigin(raw?: string | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the canonical public origin for metadata, sitemaps, robots.txt and JSON-LD.
 * Prefers explicit `NEXT_PUBLIC_SITE_URL`, then Vercel's production domain env, falling
 * back to `https://sidify.vercel.app`.
 */
export function getSiteUrl(): string {
  return (
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    DEFAULT_SITE_URL
  );
}

/** Builds an absolute canonical URL on `getSiteUrl()` from a relative path. */
export function absoluteUrl(path = "/"): string {
  const base = getSiteUrl();
  if (!path || path === "/") return `${base}/`;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/** Safe JSON serialization for `<script type="application/ld+json">`. */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Root Schema.org graph:
 * - `WebSite` with `alternateName` + `SearchAction` (Google Site Name + Sitelinks Search Box)
 * - `Organization` with brand logo and official repository link
 * - `WebApplication` (`MusicApplication`) describing Sidify's free music & song streaming features
 */
export function buildRootJsonLd(siteUrl = getSiteUrl()): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: SITE_NAME,
        alternateName: [
          "Sidify Music",
          "Sidify V2",
          "Sidify Player",
          "Sidify Music & Songs",
        ],
        description: SITE_DESCRIPTION,
        inLanguage: "en-IN",
        publisher: { "@id": `${siteUrl}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${siteUrl}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${siteUrl}/#organization`,
        name: SITE_NAME,
        url: `${siteUrl}/`,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/icon-512.png`,
          width: 512,
          height: 512,
        },
        sameAs: ["https://github.com/dastaanenajdik/Sidify-V2"],
      },
      {
        "@type": "WebApplication",
        "@id": `${siteUrl}/#webapp`,
        name: SITE_NAME,
        url: `${siteUrl}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: "MusicApplication",
        applicationSubCategory: "MultimediaApplication",
        operatingSystem: "Web, Android, iOS, Windows, macOS, Linux",
        browserRequirements: "Requires JavaScript and HTML5 Audio",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "Free full-length music and song streaming",
          "Real-time time-synced song lyrics",
          "Smart AutoPlay song radio and personalized mixes",
          "Custom playlists, liked songs and listening history",
          "Listen Together real-time music rooms with voice & video chat",
          "Offline song downloads and Android APK with studio equalizer",
          "HD movies and series streaming & downloads",
        ],
      },
    ],
  };
}

/**
 * Schema.org `SoftwareApplication` + `FAQPage` graph for `/app` (Android APK download page).
 */
export function buildAndroidAppJsonLd(siteUrl = getSiteUrl()): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${siteUrl}/app#android-app`,
        name: `${ANDROID_APP.name} Android App`,
        operatingSystem: ANDROID_APP.platform,
        applicationCategory: "MusicApplication",
        softwareVersion: ANDROID_APP.version,
        fileSize: APP_SIZE_LABEL,
        downloadUrl: ANDROID_APP.apkUrl,
        installUrl: `${siteUrl}/app`,
        isAccessibleForFree: true,
        author: { "@id": `${siteUrl}/#organization` },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        description:
          "Official free Sidify Android APK with background music playback, 5-band studio equalizer, time-synced song lyrics, and offline song downloads.",
      },
      {
        "@type": "FAQPage",
        "@id": `${siteUrl}/app#faq`,
        mainEntity: APP_FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.a,
          },
        })),
      },
    ],
  };
}

/**
 * Schema.org `CollectionPage` + `BreadcrumbList` for `/explore/[slug]` mood & genre pages.
 */
export function buildMoodJsonLd(mood: Mood, siteUrl = getSiteUrl()): Record<string, unknown> {
  const pageUrl = `${siteUrl}/explore/${mood.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${pageUrl}#collection`,
        url: pageUrl,
        name: `${mood.title} Songs & Music — Sidify`,
        description: `Stream top ${mood.q}, playlists, albums and artists free on Sidify with synced lyrics and AutoPlay radio.`,
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: SITE_NAME,
            item: `${siteUrl}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Explore Music",
            item: `${siteUrl}/explore`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: `${mood.title} Songs`,
            item: pageUrl,
          },
        ],
      },
    ],
  };
}
