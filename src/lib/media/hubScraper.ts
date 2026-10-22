/**
 * Sanitized HTML parsers and URL builders for 4KHDHub catalogue pages.
 *
 * All parsing uses `cheerio` without executing scripts, rendering untrusted markup,
 * or forwarding raw HTML into model strings. Every extracted link and image passes
 * through HTTPS + allowlist checks.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { isHostAllowed, sanitizePublicHttpsUrl } from "./safeFetch";
import type {
  Episode,
  Genre,
  Language,
  MediaKind,
  MediaMirror,
  MediaQuery,
  MediaReleaseItem,
  MediaTitle,
  Season,
} from "./types";

export const DEFAULT_HUB_BASE_URL = "https://4khdhub.one";
export const HUB_SLUG_PREFIX = "hub-";

export function hubBaseUrl(override?: string): string {
  const candidate = (override || process.env.FOURKHDHUB_BASE_URL || DEFAULT_HUB_BASE_URL).trim().replace(/\/+$/, "");
  const safe = sanitizePublicHttpsUrl(candidate);
  if (!safe) return DEFAULT_HUB_BASE_URL;
  return safe.replace(/\/+$/, "");
}

/* ----------------------------- slug safety ------------------------------- */

/** Convert a catalogue page URL or path into a safe Sidify slug (`hub-<post-slug>`). */
export function pathToHubSlug(urlOrPath: string, baseUrl = DEFAULT_HUB_BASE_URL): string | null {
  const normalized = normalizeHubPageUrl(urlOrPath, baseUrl);
  if (!normalized) return null;
  const pathname = new URL(normalized).pathname.replace(/^\/+|\/+$/g, "");
  // Reject non-item paths like `/category/...`, `/page/2`, `/tag/...`
  if (!pathname || pathname.includes("/")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(pathname)) return null;
  return `${HUB_SLUG_PREFIX}${pathname}`;
}

/** Extract validated single-segment upstream post slug from `hub-<slug>` (or bare `<slug>`). */
export function hubSlugSegment(slug: string): string | null {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  const trimmed = decoded.trim();
  const bare = trimmed.startsWith(HUB_SLUG_PREFIX) ? trimmed.slice(HUB_SLUG_PREFIX.length) : trimmed;
  if (!bare || bare.includes("/") || bare.includes("..")) return null;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(bare) ? bare : null;
}

export function isHubSlug(slug: string): boolean {
  if (slug.startsWith(HUB_SLUG_PREFIX)) return hubSlugSegment(slug) !== null;
  const bare = hubSlugSegment(slug);
  return Boolean(bare && /-(?:movie|series)-\d+$/i.test(bare));
}

export function hubDetailUrlFromSlug(slug: string, baseUrl = DEFAULT_HUB_BASE_URL): string | null {
  const seg = hubSlugSegment(slug);
  if (!seg) return null;
  const base = hubBaseUrl(baseUrl);
  return `${base}/${encodeURIComponent(seg)}/`;
}

/* -------------------------- URL normalization ---------------------------- */

/**
 * Normalize an upstream catalogue link (`href`) relative to `baseUrl`, enforcing `https:`
 * and verifying that the target host belongs to the catalogue host allowlist.
 */
export function normalizeHubPageUrl(rawHref: string | undefined | null, baseUrl = DEFAULT_HUB_BASE_URL): string | null {
  const safe = sanitizePublicHttpsUrl(rawHref, `${hubBaseUrl(baseUrl)}/`);
  if (!safe) return null;
  const parsed = new URL(safe);
  if (!isHostAllowed(parsed.hostname, "catalogue")) return null;
  return parsed.toString();
}

/** Extract a safe HTTPS image URL from an `<img>` element, handling lazy-load attributes. */
export function extractLazyPosterUrl($img: cheerio.Cheerio<AnyNode>, baseUrl = DEFAULT_HUB_BASE_URL): string | null {
  if (!$img.length) return null;
  const rawCandidates = [
    $img.attr("data-src"),
    $img.attr("data-lazy-src"),
    $img.attr("data-original"),
    firstSrcsetUrl($img.attr("data-srcset")),
    firstSrcsetUrl($img.attr("srcset")),
    $img.attr("src"),
  ];

  for (const raw of rawCandidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed || /^data:|^blob:|placeholder|blank\.gif/i.test(trimmed)) continue;
    const valid = sanitizePublicHttpsUrl(trimmed, `${hubBaseUrl(baseUrl)}/`);
    if (valid) return valid;
  }
  return null;
}

function firstSrcsetUrl(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  const firstEntry = srcset.split(",")[0]?.trim();
  return firstEntry ? firstEntry.split(/\s+/)[0] : undefined;
}

/* --------------------- genre & language vocabularies --------------------- */

const GENRE_MAP: Record<string, Genre> = {
  action: { id: "action", name: "Action" },
  "action & adventure": { id: "adventure", name: "Adventure" },
  "action_&_adventure": { id: "adventure", name: "Adventure" },
  adventure: { id: "adventure", name: "Adventure" },
  animation: { id: "animation", name: "Animation" },
  comedy: { id: "comedy", name: "Comedy" },
  crime: { id: "crime", name: "Crime" },
  documentary: { id: "documentary", name: "Documentary" },
  drama: { id: "drama", name: "Drama" },
  family: { id: "family", name: "Family" },
  fantasy: { id: "fantasy", name: "Fantasy" },
  history: { id: "history", name: "History" },
  horror: { id: "horror", name: "Horror" },
  music: { id: "music", name: "Music" },
  mystery: { id: "mystery", name: "Mystery" },
  romance: { id: "romance", name: "Romance" },
  "science fiction": { id: "sci-fi", name: "Sci-Fi" },
  "science_fiction": { id: "sci-fi", name: "Sci-Fi" },
  "sci-fi": { id: "sci-fi", name: "Sci-Fi" },
  "sci-fi & fantasy": { id: "sci-fi", name: "Sci-Fi" },
  "sci-fi_&_fantasy": { id: "sci-fi", name: "Sci-Fi" },
  thriller: { id: "thriller", name: "Thriller" },
  war: { id: "war", name: "War" },
  "war & politics": { id: "war", name: "War" },
  western: { id: "western", name: "Western" },
};

const GENRE_CATEGORY_SLUGS: Record<string, string> = {
  action: "action",
  adventure: "adventure",
  animation: "animation",
  comedy: "comedy",
  crime: "crime",
  documentary: "documentary",
  drama: "drama",
  family: "family",
  fantasy: "fantasy",
  horror: "horror",
  mystery: "mystery",
  romance: "romance",
  "sci-fi": "science_fiction",
  thriller: "thriller",
  war: "war",
  western: "western",
};

const LANGUAGE_LIST: { token: string; code: string; name: string; category?: string }[] = [
  { token: "hindi", code: "hi", name: "Hindi", category: "hindi" },
  { token: "english", code: "en", name: "English", category: "english" },
  { token: "tamil", code: "ta", name: "Tamil", category: "tamil" },
  { token: "telugu", code: "te", name: "Telugu", category: "telugu" },
  { token: "malayalam", code: "ml", name: "Malayalam", category: "malayalam" },
  { token: "kannada", code: "kn", name: "Kannada", category: "kannada" },
  { token: "korean", code: "ko", name: "Korean", category: "korean" },
  { token: "japanese", code: "ja", name: "Japanese", category: "japanese" },
  { token: "spanish", code: "es", name: "Spanish", category: "spanish" },
  { token: "chinese", code: "zh", name: "Chinese", category: "chinese" },
  { token: "french", code: "fr", name: "French", category: "french" },
];

export function hubGenres(): Genre[] {
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const genre of Object.values(GENRE_MAP)) {
    if (seen.has(genre.id)) continue;
    seen.add(genre.id);
    out.push(genre);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function hubLanguages(): Language[] {
  return LANGUAGE_LIST.map(({ code, name }) => ({ code, name }));
}

function cleanPlainText(input: string | undefined | null): string {
  return String(input || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectGenresFromText(tokens: string[]): Genre[] {
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const raw of tokens) {
    const lower = raw.trim().toLowerCase();
    const exact = GENRE_MAP[lower];
    if (exact && !seen.has(exact.id)) {
      seen.add(exact.id);
      out.push(exact);
      continue;
    }
    for (const [key, genre] of Object.entries(GENRE_MAP)) {
      if (lower.includes(key) && !seen.has(genre.id)) {
        seen.add(genre.id);
        out.push(genre);
      }
    }
  }
  return out;
}

function detectLanguageFromText(text: string): { code: string; name: string; display: string } {
  const lower = text.toLowerCase();
  const matched = LANGUAGE_LIST.filter((entry) => lower.includes(entry.token));
  if (!matched.length) return { code: "en", name: "English", display: "English" };
  return {
    code: matched[0].code,
    name: matched[0].name,
    display: matched.map((m) => m.name).join(" / "),
  };
}

export function parseSizeBytes(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2].toUpperCase();
  const factor =
    unit === "TB" ? 1024 ** 4 : unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return Math.round(value * factor);
}

export function detectQualityTier(text: string): string | undefined {
  if (/2160p|\b4k\b|\buhd\b/i.test(text)) return "2160p";
  if (/1080p/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  if (/480p/i.test(text)) return "480p";
  return undefined;
}

export function detectContainer(fileName: string, fallbackUrl = ""): string | undefined {
  const combined = `${fileName} ${fallbackUrl}`;
  const ext = combined.match(/\.(zip|rar|7z|mkv|mp4|webm|m3u8|avi|mov|ts)(?:$|[?#\s)"'\]] )/i) ||
    combined.match(/\.(zip|rar|7z|mkv|mp4|webm|m3u8|avi|mov|ts)\b/i);
  return ext ? ext[1].toUpperCase() : undefined;
}

export function extractReleaseTags(text: string): string[] {
  const tags: string[] = [];
  if (/\bREMUX\b/i.test(text)) tags.push("REMUX");
  else if (/WEB[\s-]?DL/i.test(text)) tags.push("WEB-DL");
  else if (/WEBRip/i.test(text)) tags.push("WEBRip");
  else if (/BLU[\s-]?RAY|BDRIP/i.test(text)) tags.push("BluRay");

  if (/DOLBY\s*VISION|\bDOVI\b|\bDV\b/i.test(text)) tags.push("DV");
  if (/HDR10\+/i.test(text)) tags.push("HDR10+");
  else if (/\bHDR\b/i.test(text)) tags.push("HDR");

  if (/\bAV1\b/i.test(text)) tags.push("AV1");
  else if (/\bHEVC\b|H\.?265|\bx265\b/i.test(text)) tags.push("HEVC");
  else if (/\bAVC\b|H\.?264|\bx264\b/i.test(text)) tags.push("H.264");

  return tags;
}

function parseRuntimeMinutes(raw: string): number | undefined {
  const hm = raw.match(/\b(\d{1,2})\s*h(?:r|ours?)?\s*(?:(\d{1,2})\s*m(?:in)?)?\b/i);
  if (hm) {
    const mins = Number(hm[1]) * 60 + Number(hm[2] || 0);
    if (mins > 0 && mins < 900) return mins;
  }
  const mOnly = raw.match(/\b(\d{2,3})\s*min(?:utes?)?\b/i);
  if (mOnly) {
    const mins = Number(mOnly[1]);
    if (mins > 0 && mins < 900) return mins;
  }
  return undefined;
}

function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1900 && year <= new Date().getFullYear() + 2 ? year : undefined;
}

/* ------------------------ browse & search URL build ---------------------- */

export function buildHubListUrl(kind: MediaKind | "all", query: MediaQuery, baseUrl = DEFAULT_HUB_BASE_URL): string {
  const base = hubBaseUrl(baseUrl);
  const page = Math.max(1, Math.floor(query.page || 1));
  const search = query.q?.trim();

  if (search) {
    return page > 1
      ? `${base}/page/${page}/?s=${encodeURIComponent(search)}`
      : `${base}/?s=${encodeURIComponent(search)}`;
  }

  let categorySlug: string | undefined;
  if (query.genre && GENRE_CATEGORY_SLUGS[query.genre]) {
    categorySlug = GENRE_CATEGORY_SLUGS[query.genre];
  } else if (query.language) {
    categorySlug = LANGUAGE_LIST.find((l) => l.code === query.language)?.category;
  } else if (kind === "movie") {
    categorySlug = "movies";
  } else if (kind === "series") {
    categorySlug = "series";
  }

  if (categorySlug) {
    return page > 1 ? `${base}/category/${categorySlug}/page/${page}/` : `${base}/category/${categorySlug}/`;
  }
  return page > 1 ? `${base}/page/${page}/` : `${base}/`;
}

/* ------------------------- search / card parsing ------------------------- */

export interface ParsedHubListPage {
  items: MediaTitle[];
  totalPages: number;
}

function parseCardElement(
  $: cheerio.CheerioAPI,
  cardEl: AnyNode,
  baseUrl: string,
  indexOffset = 0
): MediaTitle | null {
  const $card = $(cardEl);
  const rawHref = $card.attr("href");
  const fullUrl = normalizeHubPageUrl(rawHref, baseUrl);
  if (!fullUrl) return null;

  const slug = pathToHubSlug(fullUrl, baseUrl);
  if (!slug) return null;

  const rawTitle = cleanPlainText(
    $card.find(".movie-card-title").first().text() ||
      $card.find("h3, h2").first().text() ||
      $card.find("img").first().attr("alt")
  );
  if (!rawTitle) return null;

  const title = rawTitle.replace(/\s*\((?:19|20)\d{2}\)\s*$/, "").trim() || rawTitle;
  const metaText = cleanPlainText($card.find(".movie-card-meta").text());
  const formatTokens: string[] = [];
  $card.find(".movie-card-format, .badge, span").each((_idx, span) => {
    const t = cleanPlainText($(span).text());
    if (t) formatTokens.push(t);
  });

  const combinedText = `${formatTokens.join(" ")} ${metaText}`;
  const isSeries =
    /-series-\d+\/?$/i.test(fullUrl) ||
    formatTokens.some((t) => /^series$/i.test(t)) ||
    /\bS\d{1,2}(?:\s*[-–]\s*S?\d{1,2})?\b|\bEP?\d{1,3}\b/i.test(metaText);

  const kind: MediaKind = isSeries ? "series" : "movie";
  const year = parseYear(metaText) ?? parseYear(rawTitle);
  const genres = detectGenresFromText(formatTokens.length ? formatTokens : [combinedText]);
  const lang = detectLanguageFromText(combinedText);
  const poster = extractLazyPosterUrl($card.find("img").first(), baseUrl);

  const qualityBadges = [detectQualityTier(combinedText), ...extractReleaseTags(combinedText)].filter(Boolean);
  const overviewParts = [
    metaText,
    qualityBadges.length ? qualityBadges.join(" · ") : "",
    lang.display ? `Audio: ${lang.display}` : "",
  ].filter(Boolean);

  return {
    id: slug,
    slug,
    kind,
    title,
    overview: overviewParts.join(" — "),
    year,
    genres,
    language: lang.code,
    languageName: lang.name,
    poster,
    backdrop: poster,
    popularity: Math.max(1, 1000 - indexOffset),
    officialUrl: fullUrl,
    demo: false,
  };
}

export function parseHubSearchHtml(html: string, baseUrl = DEFAULT_HUB_BASE_URL): ParsedHubListPage {
  if (!html || typeof html !== "string") {
    return { items: [], totalPages: 1 };
  }

  const $ = cheerio.load(html);
  $("script, style, noscript, iframe").remove();

  const seen = new Set<string>();
  const items: MediaTitle[] = [];

  $("a.movie-card").each((idx, el) => {
    const parsed = parseCardElement($, el, baseUrl, idx);
    if (!parsed || seen.has(parsed.slug)) return;
    seen.add(parsed.slug);
    items.push(parsed);
  });

  let totalPages = 1;
  $("a[href*='/page/'], .pagination a, .nav-links a, .page-numbers").each((_idx, el) => {
    const href = $(el).attr("href") || "";
    const hrefMatch = href.match(/\/page\/(\d+)\b/i);
    if (hrefMatch) {
      const n = Number(hrefMatch[1]);
      if (Number.isFinite(n) && n > totalPages) totalPages = n;
    }
    const textNum = Number(cleanPlainText($(el).text()).replace(/,/g, ""));
    if (Number.isFinite(textNum) && textNum > totalPages && textNum <= 10_000) {
      totalPages = textNum;
    }
  });

  return { items, totalPages };
}

/* ----------------------- detail / release parsing ------------------------ */

function extractMirrorsFromContainer(
  $: cheerio.CheerioAPI,
  $container: cheerio.Cheerio<AnyNode>,
  prefixId: string,
  selector = "a[href]"
): MediaMirror[] {
  const mirrors: MediaMirror[] = [];
  const seenUrls = new Set<string>();

  $container.find(selector).each((idx, a) => {
    const rawHref = $(a).attr("href");
    const safeUrl = sanitizePublicHttpsUrl(rawHref);
    if (!safeUrl || seenUrls.has(safeUrl)) return;

    const parsed = new URL(safeUrl);
    // Reject internal catalogue category/navigation links inside containers
    if (isHostAllowed(parsed.hostname, "catalogue")) return;
    if (!isHostAllowed(parsed.hostname, "mirror")) return;

    seenUrls.add(safeUrl);
    const rawLabel = cleanPlainText($(a).text());
    const label = rawLabel || `Mirror ${mirrors.length + 1}`;
    mirrors.push({
      id: `${prefixId}-m${idx + 1}`,
      label,
      shortUrl: safeUrl,
      host: parsed.hostname.toLowerCase(),
    });
  });

  return mirrors;
}

export interface ParsedHubDetail {
  title: MediaTitle;
  releases: MediaReleaseItem[];
  seasons: Season[];
  related: MediaTitle[];
}

export function parseHubDetailHtml(
  html: string,
  pageUrl: string,
  baseUrl = DEFAULT_HUB_BASE_URL
): ParsedHubDetail | null {
  if (!html || typeof html !== "string") return null;
  const safePageUrl = normalizeHubPageUrl(pageUrl, baseUrl);
  if (!safePageUrl) return null;
  const slug = pathToHubSlug(safePageUrl, baseUrl);
  if (!slug) return null;

  const $ = cheerio.load(html);
  $("script, style, noscript, iframe").remove();

  const rawHeading = cleanPlainText($("h1").first().text());
  if (!rawHeading) return null;

  const headingYearMatch = rawHeading.match(/\((\d{4})\)\s*$/);
  const cleanTitle = rawHeading.replace(/\s*\(\d{4}\)\s*$/, "").trim() || rawHeading;

  // Poster with lazy-load support and meta og:image fallback
  const poster =
    extractLazyPosterUrl(
      $(".poster-image img, .movie-poster img, img[alt*='Poster' i]").first(),
      baseUrl
    ) ||
    sanitizePublicHttpsUrl($('meta[property="og:image"]').attr("content"), safePageUrl) ||
    extractLazyPosterUrl($("main img, article img").first(), baseUrl);

  const backdrop =
    sanitizePublicHttpsUrl($('meta[name="twitter:image"]').attr("content"), safePageUrl) || poster;

  // Category links supply clean genres, audio tags, and movie vs series hints
  const categoryTokens: string[] = [];
  $("a[href*='/category/']").each((_idx, el) => {
    const label = cleanPlainText($(el).text());
    if (label) categoryTokens.push(label);
  });

  const bodyText = cleanPlainText($("body").text());

  const releaseDateMatch = bodyText.match(/(?:Release|Last\s*Air)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  const releaseDate = releaseDateMatch?.[1];
  const year =
    (headingYearMatch ? Number(headingYearMatch[1]) : undefined) ??
    parseYear(releaseDate) ??
    parseYear(rawHeading);

  const ratingMatch = bodyText.match(/IMDb\s*:?\s*(\d(?:\.\d)?)\b/i);
  const rating = ratingMatch ? Math.min(10, Math.max(0, Number(ratingMatch[1]))) : undefined;
  const runtimeMinutes = parseRuntimeMinutes(bodyText);

  const audiosMatch = bodyText.match(/Audios?\s*:\s*([A-Za-z,\s/]+?)(?=(?:Seasons?|Uploader|Download|Watch|$))/i);
  const langSource = `${audiosMatch?.[1] || ""} ${categoryTokens.join(" ")}`;
  const lang = detectLanguageFromText(langSource);
  const genres = detectGenresFromText(categoryTokens);

  // Extract clean synopsis paragraph (prefer og:description or main narrative paragraph)
  let overview = cleanPlainText($('meta[property="og:description"]').attr("content"));
  if (!overview || overview.length < 25) {
    $("p").each((_idx, p) => {
      if (overview && overview.length >= 40) return;
      const candidate = cleanPlainText($(p).text());
      if (
        candidate.length >= 40 &&
        !/^(?:Stars|Director|Release|Last Air|Prints?|Audios?|Seasons?|Click on the download)/i.test(candidate)
      ) {
        overview = candidate;
      }
    });
  }

  // 1. Movie Downloads & Season ZIP Packs (`.download-item`)
  const releases: MediaReleaseItem[] = [];
  $(".download-item").each((idx, itemEl) => {
    const $item = $(itemEl);
    const headerTitle = cleanPlainText($item.find(".font-semibold").first().text());
    const fileTitle = cleanPlainText($item.find(".file-title").first().text());
    const displayTitle = headerTitle || fileTitle || `Release ${idx + 1}`;
    const effectiveFileName = fileTitle || displayTitle;

    const itemText = cleanPlainText($item.text());
    const sizeMatch = itemText.match(/([\d.]+\s*(?:TB|GB|MB))/i);
    const size = sizeMatch ? cleanPlainText(sizeMatch[1]) : undefined;

    const mirrors = extractMirrorsFromContainer($, $item, `rel-${idx + 1}`);
    if (!mirrors.length) return;

    const combinedMeta = `${displayTitle} ${effectiveFileName} ${itemText}`;
    const container = detectContainer(effectiveFileName);
    const isPack = container === "ZIP" || container === "RAR" || container === "7Z";
    const seasonMatch = combinedMeta.match(/\bS(\d{1,2})\b/i);
    const detectedLang = detectLanguageFromText(combinedMeta);

    releases.push({
      id: `rel-${idx + 1}`,
      title: displayTitle,
      fileName: effectiveFileName,
      quality: detectQualityTier(combinedMeta),
      size,
      sizeBytes: parseSizeBytes(size),
      container,
      languages: detectedLang.display,
      tags: extractReleaseTags(combinedMeta),
      isPack,
      seasonNumber: seasonMatch ? Number(seasonMatch[1]) : undefined,
      mirrors,
    });
  });

  // 2. Series Individual Episodes — supports BOTH live `.episode-item` AND `.season-item`
  //    plus fallback standalone `.episode-download-item` containers.
  const episodeReleases: MediaReleaseItem[] = [];
  const processedEpisodeNodes = new Set<AnyNode>();

  $(".episode-item, .season-item").each((groupIdx, groupEl) => {
    const $group = $(groupEl);
    const groupTitle = cleanPlainText($group.find(".episode-title").first().text());
    const groupNumberBadge = cleanPlainText($group.find(".episode-number").first().text());
    const groupSeasonMatch =
      groupNumberBadge.match(/S?(\d{1,2})/i) || groupTitle.match(/\bS(?:eason\s*)?(\d{1,2})\b/i);
    const defaultSeason = groupSeasonMatch ? Number(groupSeasonMatch[1]) : 1;

    $group.find(".episode-download-item").each((epIdx, epEl) => {
      processedEpisodeNodes.add(epEl);
      const parsedEp = parseEpisodeDownloadNode($, epEl, `ep-${groupIdx + 1}-${epIdx + 1}`, groupTitle, defaultSeason);
      if (parsedEp) episodeReleases.push(parsedEp);
    });
  });

  // Fallback for pages where `.episode-download-item` is not wrapped in `.episode-item` / `.season-item`
  $(".episode-download-item").each((epIdx, epEl) => {
    if (processedEpisodeNodes.has(epEl)) return;
    const parsedEp = parseEpisodeDownloadNode($, epEl, `ep-standalone-${epIdx + 1}`, "", 1);
    if (parsedEp) episodeReleases.push(parsedEp);
  });

  // Assemble structured Seasons & deduplicated Episodes with multi-quality releases attached
  const seasonsMap = new Map<number, Map<number, Episode>>();
  for (const epRel of episodeReleases) {
    const sNum = epRel.seasonNumber || 1;
    const eNum = epRel.episodeNumber || 1;
    let epMap = seasonsMap.get(sNum);
    if (!epMap) {
      epMap = new Map<number, Episode>();
      seasonsMap.set(sNum, epMap);
    }
    const existing = epMap.get(eNum);
    if (!existing) {
      epMap.set(eNum, {
        id: `${slug}-s${sNum}e${eNum}`,
        seasonNumber: sNum,
        episodeNumber: eNum,
        title: `Episode ${eNum}`,
        size: epRel.size,
        releases: [epRel],
      });
    } else {
      existing.releases = [...(existing.releases || []), epRel];
    }
  }

  const seasons: Season[] = [...seasonsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, epMap]) => ({
      id: `${slug}-s${seasonNumber}`,
      seasonNumber,
      name: `Season ${seasonNumber}`,
      episodes: [...epMap.values()].sort((a, b) => a.episodeNumber - b.episodeNumber),
    }));

  // 3. Related cards (`You May Also Like`)
  const related: MediaTitle[] = [];
  const seenRelated = new Set<string>([slug]);
  $("a.movie-card").each((idx, cardEl) => {
    const item = parseCardElement($, cardEl, baseUrl, idx);
    if (!item || seenRelated.has(item.slug)) return;
    seenRelated.add(item.slug);
    related.push(item);
  });

  const isSeries =
    /-series-\d+\/?$/i.test(safePageUrl) ||
    seasons.length > 0 ||
    categoryTokens.some((c) => /series/i.test(c));

  const totalEpisodes = seasons.reduce((sum, s) => sum + s.episodes.length, 0);

  return {
    title: {
      id: slug,
      slug,
      kind: isSeries ? "series" : "movie",
      title: cleanTitle,
      overview: overview || `${cleanTitle}${year ? ` (${year})` : ""}.`,
      year,
      releaseDate,
      genres,
      language: lang.code,
      languageName: lang.name,
      rating,
      runtimeMinutes,
      poster,
      backdrop,
      seasonCount: isSeries ? Math.max(seasons.length, 1) : undefined,
      episodeCount: isSeries && totalEpisodes > 0 ? totalEpisodes : undefined,
      officialUrl: safePageUrl,
      demo: false,
    },
    releases,
    seasons,
    related: related.slice(0, 12),
  };
}

function parseEpisodeDownloadNode(
  $: cheerio.CheerioAPI,
  epEl: AnyNode,
  id: string,
  groupTitle: string,
  fallbackSeason: number
): MediaReleaseItem | null {
  const $ep = $(epEl);
  const fileName = cleanPlainText($ep.find(".episode-file-title").first().text());
  const badgeText = cleanPlainText($ep.find(".badge-psa").first().text());
  const size = cleanPlainText($ep.find(".badge-size").first().text()) || undefined;

  let mirrors = extractMirrorsFromContainer($, $ep, id, ".episode-links a[href]");
  if (!mirrors.length) {
    mirrors = extractMirrorsFromContainer($, $ep, id, "a[href]");
  }
  if (!mirrors.length) return null;

  const seMatch = `${fileName} ${groupTitle}`.match(/S(\d{1,2})\s*E(\d{1,3})/i);
  const badgeEpMatch = badgeText.match(/Episode[-\s]*(\d{1,3})/i) || badgeText.match(/\bE?(\d{1,3})\b/);

  const seasonNumber = seMatch ? Number(seMatch[1]) : fallbackSeason;
  const episodeNumber = seMatch
    ? Number(seMatch[2])
    : badgeEpMatch
      ? Number(badgeEpMatch[1])
      : 1;

  const combined = `${groupTitle} ${fileName} ${badgeText}`;
  const lang = detectLanguageFromText(combined);

  return {
    id,
    title: groupTitle || fileName || `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`,
    fileName: fileName || groupTitle || `Episode ${episodeNumber}`,
    quality: detectQualityTier(combined),
    size,
    sizeBytes: parseSizeBytes(size),
    container: detectContainer(fileName),
    languages: lang.display,
    tags: extractReleaseTags(combined),
    seasonGroup: groupTitle || undefined,
    seasonNumber,
    episodeNumber,
    mirrors,
  };
}
