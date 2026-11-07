# Sidify SEO & Google Search Console Guide

This repository ships complete technical SEO out of the box so **Sidify** can be crawled, indexed, and ranked cleanly on Google, Bing, and AI answer engines.

## Included SEO Files

- **`src/lib/seo.ts`** — Central canonical URL helper (`getSiteUrl()`), target keywords (`Sidify`, `music`, `songs`, `Spotify` alternatives, genres), and Schema.org JSON-LD builders (`WebSite` + `SearchAction`, `Organization`, `WebApplication`, `SoftwareApplication`, `FAQPage`, `CollectionPage`, `BreadcrumbList`).
- **`src/components/JsonLd.tsx`** — XSS-safe `<script type="application/ld+json">` renderer.
- **`src/app/robots.ts`** — Generates `/robots.txt` allowing `Googlebot`, `Googlebot-Image`, and `Bingbot` on all public routes while excluding `/api/`, `/dev/`, and local-only `/library/`, `/downloads`, and `/settings` routes, and declaring `Sitemap: https://sidify.vercel.app/sitemap.xml`.
- **`src/app/sitemap.ts`** — Generates `/sitemap.xml` covering `/`, `/search`, `/explore`, `/rooms`, `/app`, `/movies`, `/series`, `/exclusive`, and all 26 `/explore/[slug]` music mood & genre pages.
- **`src/app/opengraph-image.tsx` & `src/app/twitter-image.tsx`** — Generates `1200×630` branded OpenGraph & Twitter preview cards.
- **`public/llms.txt` & `public/humans.txt`** — Structured site overview for AI search engines and crawlers.

## Connect Google Search Console (1-Minute Setup)

1. Open [Google Search Console](https://search.google.com/search-console) and add your property (`https://sidify.vercel.app` or your custom domain).
2. Choose **HTML tag** verification and copy the `content="..."` token.
3. In Vercel → **Project Settings → Environment Variables**, add:
   - `NEXT_PUBLIC_SITE_URL=https://sidify.vercel.app` (or your custom domain)
   - `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=<your-token>`
4. Redeploy, click **Verify** in Google Search Console, then open **Sitemaps** and submit:
   - `https://sidify.vercel.app/sitemap.xml`
