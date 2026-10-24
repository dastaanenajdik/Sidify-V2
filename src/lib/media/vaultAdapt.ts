/**
 * Adapters turning Vault API payloads into Sidify's media models.
 *
 * A TypeScript port of the reference terminal client's `adapt.rs`:
 *   - search subjects  → `MediaTitle`
 *   - subject details  → `MediaDetail` (incl. seasons/episodes)
 *   - play-info        → `MediaReleaseItem` (one per quality, DASH manifest + headers)
 *   - resource items   → `MediaReleaseItem` (direct file links = downloads)
 *
 * Server-only.
 */

import type {
  Episode,
  Genre,
  MediaMirror,
  MediaReleaseItem,
  MediaTitle,
  Season,
} from "./types";

/** Referer the CDN expects on signed DASH requests. */
export const VAULT_STREAM_REFERER = "https://sportslive.wine";

/** Slug prefix that marks a Vault title. */
export const VAULT_SLUG_PREFIX = "vault-";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** `subjectId` / `id` as a string. */
export function subjectIdOf(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const raw = record.subjectId ?? record.id;
  const id = str(raw);
  return id && id.trim() ? id.trim() : null;
}

/** First four digits of a release-date-ish string. */
export function extractYear(value: unknown): number | null {
  const text = str(value);
  if (!text) return null;
  const match = text.match(/(\d{4})/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  return year >= 1900 && year <= 2099 ? year : null;
}

/* ------------------------------- titles ---------------------------------- */

/** Vault subject type: 1 = movie, 2 = series. */
export function subjectKind(value: unknown): "movie" | "series" {
  const record = asRecord(value);
  const type = record ? num(record.subjectType ?? record.stype) : null;
  return type === 2 ? "series" : "movie";
}

export function subjectPoster(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const cover = asRecord(record.cover);
  const candidate = cover ? str(cover.url) : null;
  return candidate ?? str(record.coverUrl) ?? str(record.poster) ?? str(record.pic);
}

/** Clean a bracketed/suffixed catalogue title ("[Dub] Dune [2021] 1080p" → "Dune"). */
export function cleanTitle(raw: string): string {
  let title = raw.trim();
  if (!title) return "";

  while (title.startsWith("[")) {
    const close = title.indexOf("]");
    if (close === -1) break;
    const remainder = title.slice(close + 1).trim();
    if (!remainder) break;
    title = remainder;
  }

  const bracket = title.indexOf("[");
  if (bracket > 0) title = title.slice(0, bracket).trim();

  const paren = title.indexOf("(");
  if (paren > 0) {
    const inside = title.slice(paren + 1).split(")")[0]?.trim() ?? "";
    const isYear = /^\d{4}$/.test(inside) && Number(inside) >= 1900 && Number(inside) <= 2099;
    if (!isYear) title = title.slice(0, paren).trim();
  }

  const languageTags = [
    "hindi",
    "tamil",
    "telugu",
    "kannada",
    "malayalam",
    "bengali",
    "marathi",
    "punjabi",
    "gujarati",
    "urdu",
    "english",
    "spanish",
    "french",
    "german",
    "italian",
    "japanese",
    "korean",
    "chinese",
    "russian",
    "portuguese",
    "turkish",
    "arabic",
    "dub",
    "audio",
    "multi",
  ];
  const dashSuffix = title.lastIndexOf(" - ");
  if (dashSuffix > 0) {
    const suffix = title.slice(dashSuffix + 3).toLowerCase();
    const isTag =
      languageTags.some((tag) => suffix.includes(tag)) ||
      suffix.startsWith("season") ||
      (/^s\d+(-\d+)?$/.test(suffix) && /\d/.test(suffix));
    if (isTag) title = title.slice(0, dashSuffix).trim();
  }

  const seasonMarker = title.lastIndexOf(" S");
  if (seasonMarker > 0) {
    const suffix = title.slice(seasonMarker + 2);
    if (/^\d+([\dS-]*)$/.test(suffix) && /\d/.test(suffix)) title = title.slice(0, seasonMarker).trim();
  }

  for (const separator of ["_", " ", ".", "-"]) {
    const index = title.lastIndexOf(separator);
    if (index <= 0) continue;
    const suffix = title.slice(index + 1);
    const isResolution = /^\d+p$/i.test(suffix) && suffix.length > 1;
    if (isResolution) title = title.slice(0, index).trim();
  }

  const cleaned = title.replace(/[-:_. ]+$/, "").trim();
  return cleaned || raw.trim();
}

/** Language display name → ISO-639-1 code. */
export function languageCode(name: unknown): string | null {
  const lower = str(name)?.trim().toLowerCase();
  if (!lower) return null;
  const map: Record<string, string> = {
    english: "en",
    hindi: "hi",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    portuguese: "pt",
    russian: "ru",
    arabic: "ar",
    turkish: "tr",
    bengali: "bn",
    tamil: "ta",
    telugu: "te",
    kannada: "kn",
    malayalam: "ml",
    marathi: "mr",
    punjabi: "pa",
    gujarati: "gu",
    urdu: "ur",
    indonesian: "id",
    thai: "th",
    vietnamese: "vi",
    dutch: "nl",
    polish: "pl",
    swedish: "sv",
    danish: "da",
    norwegian: "no",
    finnish: "fi",
    greek: "el",
    hebrew: "he",
    czech: "cs",
    hungarian: "hu",
    romanian: "ro",
    ukrainian: "uk",
    persian: "fa",
    tagalog: "tl",
    malay: "ms",
  };
  if (map[lower]) return map[lower];
  if (/^[a-z]{2}$/.test(lower)) return lower;
  return null;
}

/** `vault-<subjectId>-<slug>` — the `vault-` prefix identifies this source. */
export function vaultSlug(subjectId: string, title: string): string {
  const slug = cleanTitle(title)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${VAULT_SLUG_PREFIX}${subjectId}-${slug || "untitled"}`;
}

/** Extract the subject id back out of a Vault slug. */
export function subjectIdFromSlug(slug: string): string | null {
  if (!slug?.startsWith(VAULT_SLUG_PREFIX)) return null;
  const rest = slug.slice(VAULT_SLUG_PREFIX.length);
  const match = rest.match(/^(\d+)(?:-|$)/);
  return match ? match[1] : null;
}

export function isVaultSlug(slug: string): boolean {
  return subjectIdFromSlug(slug) !== null;
}

/** Genres as `{ id, name }` pairs, ids slugified so they can be used as facet filters. */
function genresOf(record: Record<string, unknown>): Genre[] {
  const raw = record.genre ?? record.genres;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const entry of raw) {
    const name = str(entry);
    if (!name || !name.trim()) continue;
    const clean = name.trim();
    const id = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: clean });
  }
  return out;
}

/** A search result / catalogue entry. */
export function subjectToTitle(value: unknown): MediaTitle | null {
  const record = asRecord(value);
  if (!record) return null;

  const subjectId = subjectIdOf(record);
  if (!subjectId) return null;

  const rawTitle = str(record.title) ?? str(record.name) ?? "Untitled";
  const kind = subjectKind(record);
  const year = extractYear(record.releaseDate ?? record.year ?? record.releaseInfo);
  const genres = genresOf(record);

  return {
    id: subjectId,
    slug: vaultSlug(subjectId, rawTitle),
    kind,
    title: cleanTitle(rawTitle),
    tagline: str(record.tagline) ?? undefined,
    overview: str(record.description) ?? str(record.intro) ?? "",
    year: year ?? undefined,
    releaseDate: str(record.releaseDate) ?? undefined,
    genres,
    language: languageCode(record.lanName ?? record.language ?? record.country) ?? "en",
    languageName: str(record.lanName ?? record.language) ?? undefined,
    rating: num(record.imdbRatingValue ?? record.imdbRate ?? record.imdb_rating ?? record.rating) ?? undefined,
    votes: num(record.imdbVoteCount ?? record.voteCount) ?? undefined,
    runtimeMinutes: num(record.duration) ? Math.round(Number(num(record.duration)) / 60) : undefined,
    certification: str(record.certification) ?? undefined,
    poster: subjectPoster(record),
    backdrop: subjectPoster(record),
    accent: undefined,
    seasonCount: num(record.season ?? record.seasons) ?? undefined,
    episodeCount: num(record.totalEpisode ?? record.episodeCount) ?? undefined,
    status: str(record.status) ?? undefined,
    // The listing's ranking signals: the reference client reads the same fields.
    popularity: num(
      record.__browse_rank ??
        record.imdb_popularity ??
        record.imdbPopularity ??
        record.popularity ??
        record.viewers ??
        record.hotValue
    ) ?? undefined,
    officialUrl: str(record.officialUrl) ?? null,
  };
}

/**
 * Search payload → titles.
 *
 * The API groups its matches: `results` is an array of result groups and each group
 * carries a `subjects` array. Every group is read — the upstream's own reference
 * client only looked at the first one, but the API does put matches in later
 * groups too, and dropping them is what made the collection look empty.
 *
 * The payload may arrive with or without the `data` envelope (the reference
 * client strips it before adapting, but a raw response must parse too), and a
 * flat `subjects` / `list` payload is accepted as well.
 */
export function searchPayloadToTitles(payload: unknown): MediaTitle[] {
  const root = asRecord(payload);
  if (!root) return [];

  // The `data` envelope may still be present.
  const inner = asRecord(root.data);
  const scope = inner ?? root;

  const subjects: unknown[] = [];

  const collectFromGroups = (groups: unknown[]) => {
    for (const group of groups) {
      const groupRecord = asRecord(group);
      if (!groupRecord) continue;
      if (Array.isArray(groupRecord.subjects)) subjects.push(...groupRecord.subjects);
      else if (Array.isArray(groupRecord.list)) subjects.push(...groupRecord.list);
    }
  };

  const results = scope.results;
  if (Array.isArray(results)) {
    // `results` is an array of groups, each with its own `subjects`.
    collectFromGroups(results);
  } else {
    const resultsRecord = asRecord(results);
    if (resultsRecord) {
      // Some responses wrap the groups in `results.list`.
      const groups = Array.isArray(resultsRecord.list) ? resultsRecord.list : null;
      if (groups) collectFromGroups(groups);
      else {
        if (Array.isArray(resultsRecord.subjects)) subjects.push(...resultsRecord.subjects);
        else if (Array.isArray(resultsRecord.list)) subjects.push(...resultsRecord.list);
      }
    }
  }

  if (!subjects.length) {
    if (Array.isArray(scope.subjects)) subjects.push(...scope.subjects);
    else if (Array.isArray(scope.list)) subjects.push(...scope.list);
  }

  // The known shapes came up empty. Rather than answer with an empty list — which
  // is indistinguishable from "the catalogue has no titles" — look for the
  // subjects wherever they actually are.
  if (!subjects.length) {
    const deep = collectSubjectsDeep(scope);
    if (deep.length) return titlesFromSubjects(deep);
  }

  return titlesFromSubjects(subjects);
}

/**
 * Finds the subjects in a payload whose exact shape we do not know.
 *
 * The listing endpoint has changed shape between versions — the groups have
 * appeared under `items`, `list` and `operatingList`, and the rows have carried
 * their subject either nested (`.subject`) or flat (the row *is* the subject).
 * A strict adapter answers with an empty list for every one of those, which the
 * UI cannot tell apart from an empty catalogue.
 *
 * So this walks the payload and collects every object that looks like a subject:
 * something with an id **and** a title **and** at least one media marker. The
 * media marker is what keeps a row or a banner (which also carry an id and a
 * title) from being mistaken for a title.
 */
export function collectSubjectsDeep(payload: unknown): unknown[] {
  const found: unknown[] = [];
  const visited = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || !node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const record = node as Record<string, unknown>;

    // A wrapper may hold the real subject under `subject`.
    const nested = asRecord(record.subject);
    if (nested && looksLikeSubject(nested)) {
      found.push(nested);
      return;
    }

    if (looksLikeSubject(record)) {
      found.push(record);
      // A subject does not contain another subject — stop here.
      return;
    }

    for (const value of Object.values(record)) {
      walk(value, depth + 1);
    }
  };

  walk(payload, 0);
  return found;
}

/**
 * Whether a record looks like a title.
 *
 * It needs an id and a title, plus one marker that only a real title carries —
 * its type, its artwork, its release date or its rating. Without that third
 * condition a row or a banner would pass for a title.
 */
function looksLikeSubject(record: Record<string, unknown>): boolean {
  const hasId = record.subjectId !== undefined || record.id !== undefined;
  if (!hasId) return false;

  const hasTitle = typeof record.title === "string" || typeof record.name === "string";
  if (!hasTitle) return false;

  return (
    record.subjectType !== undefined ||
    record.stype !== undefined ||
    record.cover !== undefined ||
    record.coverUrl !== undefined ||
    record.poster !== undefined ||
    record.pic !== undefined ||
    record.releaseDate !== undefined ||
    record.year !== undefined ||
    record.releaseInfo !== undefined ||
    record.imdbRatingValue !== undefined ||
    record.genre !== undefined ||
    record.genres !== undefined
  );
}

/**
 * Homepage payload → titles.
 *
 * The catalogue's own listing endpoint answers with `items`: an array of groups,
 * and a group can carry its subjects in three different places depending on the
 * row type — a banner (`banner.banners[].subject`), a custom row
 * (`customData.items[].subject`) or a plain grid (`subjects[]`).
 *
 * This mirrors the reference client's `moviebox_homepage_json_to_catalog`.
 */
export function homepagePayloadToTitles(payload: unknown): MediaTitle[] {
  const root = asRecord(payload);
  if (!root) return Array.isArray(payload) ? titlesFromSubjects(collectSubjectsDeep(payload)) : [];

  // The envelope is usually stripped by the client, but tolerate it here too.
  const scope = asRecord(root.data) ?? root;

  const groups = groupsOf(scope);
  const subjects: unknown[] = [];

  for (const group of groups) {
    const groupRecord = asRecord(group);
    if (!groupRecord) continue;

    // Banner row: `banner.banners[]`, each item either `{subject}` or the subject.
    const banner = asRecord(groupRecord.banner);
    if (banner && Array.isArray(banner.banners)) {
      for (const bannerItem of banner.banners) {
        pushSubject(subjects, bannerItem);
      }
    }

    // Custom row: `customData.items[]`, each item either `{subject}` or the subject.
    const customData = asRecord(groupRecord.customData);
    if (customData && Array.isArray(customData.items)) {
      for (const customItem of customData.items) {
        pushSubject(subjects, customItem);
      }
    }

    // Plain grid: `subjects[]`.
    if (Array.isArray(groupRecord.subjects)) {
      for (const entry of groupRecord.subjects) pushSubject(subjects, entry);
    }
  }

  // The known shapes came up empty. Rather than answer with an empty list — which
  // is indistinguishable from "the catalogue has no titles" — look for the
  // subjects wherever they actually are.
  if (!subjects.length) {
    const deep = collectSubjectsDeep(scope);
    return titlesFromSubjects(deep);
  }

  return titlesFromSubjects(subjects);
}

/**
 * The groups (rows) of a listing payload.
 *
 * The key has changed between versions: `items` is the documented one, but
 * `operatingList`, `list`, `modules` and `groups` have all carried the same row
 * structure. A payload that is a bare array *is* the group list.
 */
function groupsOf(scope: Record<string, unknown>): unknown[] {
  for (const key of ["items", "operatingList", "list", "modules", "groups", "rows"]) {
    const value = scope[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Pushes a row item that is either `{subject}` or a flat subject. */
function pushSubject(into: unknown[], item: unknown): void {
  const record = asRecord(item);
  if (!record) return;
  const subject = asRecord(record.subject);
  into.push(subject ?? record);
}

/** Subjects → titles, skipping the ones without an id and dropping duplicates. */
function titlesFromSubjects(subjects: unknown[]): MediaTitle[] {
  const titles: MediaTitle[] = [];
  const seen = new Set<string>();
  for (const entry of subjects) {
    const title = subjectToTitle(entry);
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    titles.push(title);
  }
  return titles;
}
/** Season/episode structure for a series subject. */
function seasonsOf(record: Record<string, unknown>): Season[] {
  const seasonsValue = asRecord(record.seasons);
  const list = Array.isArray(seasonsValue?.seasons)
    ? seasonsValue.seasons
    : Array.isArray(record.seasons)
      ? record.seasons
      : [];
  if (!list.length) return [];

  const seasons: Season[] = [];
  for (const entry of list) {
    const seasonRecord = asRecord(entry);
    if (!seasonRecord) continue;
    const seasonNumber = num(seasonRecord.se ?? seasonRecord.seasonNumber) ?? 1;

    const episodes: Episode[] = [];
    const episodeNumbers = seasonRecord.episodeNumbers;
    if (Array.isArray(episodeNumbers)) {
      for (const value of episodeNumbers) {
        const number = num(value);
        if (number === null) continue;
        episodes.push({
          id: `${seasonNumber}-${number}`,
          seasonNumber,
          episodeNumber: number,
          title: `Episode ${number}`,
          overview: "",
        });
      }
    } else {
      const maxEpisode = num(seasonRecord.maxEp ?? seasonRecord.episodeCount);
      if (maxEpisode && maxEpisode > 0) {
        for (let number = 1; number <= Math.min(maxEpisode, 500); number++) {
          episodes.push({
            id: `${seasonNumber}-${number}`,
            seasonNumber,
            episodeNumber: number,
            title: `Episode ${number}`,
            overview: "",
          });
        }
      }
    }

    seasons.push({
      id: String(seasonNumber),
      seasonNumber,
      name: str(seasonRecord.name) ?? `Season ${seasonNumber}`,
      overview: str(seasonRecord.description) ?? undefined,
      airDate: str(seasonRecord.releaseDate) ?? undefined,
      poster: subjectPoster(seasonRecord),
      episodes,
    });
  }
  return seasons;
}

/** Subject details → a title + seasons. */
export function detailsPayloadToDetail(payload: unknown): { title: MediaTitle; seasons: Season[] } | null {
  const root = asRecord(payload);
  if (!root) return null;

  const subject = asRecord(root.subject) ?? root;
  const title = subjectToTitle(subject);
  if (!title) return null;

  return { title, seasons: seasonsOf(subject) };
}

/* ------------------------------ releases --------------------------------- */

/** Placeholder/"upgraded clip" URLs that never resolve to the real file. */
export function isDeprecationNoticeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("1c7de0bd3393702d9191801f15f88f8d") ||
    lower.includes("9a0461bc39da389663bf3dbb17091d3f") ||
    lower.includes("b164fbfb4347792950bdfbfb563d39d9") ||
    lower.includes("/notice.mp4") ||
    (lower.includes("macdn.aoneroom.com") && lower.includes("/other/"))
  );
}

function decodeBase64(value: string): Buffer | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/~/g, "/");
  try {
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const buffer = Buffer.from(padded, "base64");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

/** `<prefix>/index.mpd` for a DASH root. */
function toDashMpd(url: string): string | null {
  const base = url.replace(/\*+$/, "").replace(/\/+$/, "");
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) return null;
  if (!base.includes("/dash/")) return null;
  return `${base}/index.mpd`;
}

/**
 * Resolves the DASH manifest URL out of a signed-cookie header.
 *
 * Two shapes are supported:
 *   `Edge-Cache-Cookie=urlprefix=<base64 url>:sign=…:t=…`
 *   `CloudFront-Policy=<base64 json>;CloudFront-Signature=…`
 */
export function resolveDashManifestFromPolicy(signCookie: string): string | null {
  for (const part of signCookie.split(";")) {
    const trimmed = part.trim();

    const prefixIndex = trimmed.indexOf("urlprefix=");
    if (prefixIndex !== -1) {
      const prefixPart = trimmed.slice(prefixIndex + "urlprefix=".length);
      const token = (prefixPart.split(":")[0] ?? prefixPart).trim();
      const decoded = decodeBase64(token);
      if (decoded) {
        const url = decoded.toString("utf8");
        const mpd = toDashMpd(url);
        if (mpd) return mpd;
      }
    }

    if (trimmed.startsWith("CloudFront-Policy=")) {
      const decoded = decodeBase64(trimmed.slice("CloudFront-Policy=".length).trim());
      if (!decoded) continue;
      try {
        const policy = JSON.parse(decoded.toString("utf8")) as {
          Statement?: Array<{ Resource?: string }>;
        };
        const resource = policy.Statement?.[0]?.Resource;
        if (!resource) continue;
        const mpd = toDashMpd(resource);
        if (mpd) return mpd;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Headers a signed DASH request needs. */
export function dashRequestHeaders(signCookie: string, userAgent: string): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ["Referer", VAULT_STREAM_REFERER],
    ["User-Agent", userAgent],
  ];
  if (signCookie.trim()) {
    const cookie = signCookie
      .trim()
      .replace(/;\s*$/, "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("; ");
    if (cookie) headers.push(["Cookie", cookie]);
  }
  return headers;
}

/** One release per advertised quality, all pointing at the same DASH manifest. */
export function playInfoToReleases(
  payload: unknown,
  season: number,
  episode: number,
  userAgent: string
): MediaReleaseItem[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) return [];

  const streams = Array.isArray(data.streams) ? data.streams : [];
  if (!streams.length) return [];

  const titlePrefix = cleanTitle(str(data.title) ?? "Movie");
  const releases: MediaReleaseItem[] = [];

  for (const entry of streams) {
    const stream = asRecord(entry);
    if (!stream) continue;

    const streamId = str(stream.id) ?? null;
    const format = str(stream.format) ?? "MP4";
    const codec = str(stream.codecName ?? stream.codec) ?? undefined;
    const sizeBytes = num(stream.size) ?? undefined;

    const resolutionsRaw =
      str(stream.resolutions) ?? str(data.displayResolutions) ?? "1080,720,480";
    const resolutions = [
      ...new Set(
        resolutionsRaw
          .split(",")
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0)
      ),
    ].sort((a, b) => b - a);
    if (!resolutions.length) resolutions.push(1080);

    const signCookie = str(stream.signCookie) ?? "";
    const streamUrl = str(stream.url) ?? "";

    const manifestUrl =
      resolveDashManifestFromPolicy(signCookie) ??
      (!isDeprecationNoticeUrl(streamUrl) && /^https?:\/\//i.test(streamUrl) ? streamUrl : null);
    if (!manifestUrl) continue;

    const headers = dashRequestHeaders(signCookie, userAgent);
    const codecLabel = codec ?? format;
    const highest = resolutions[0];

    for (const resolution of resolutions) {
      const label = `${resolution}p`;
      const fileName =
        season > 0 && episode > 0
          ? `${titlePrefix} S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")} ${label} ${codecLabel}`
          : `${titlePrefix} ${label} ${codecLabel}`;

      const scaledSize =
        sizeBytes === undefined
          ? undefined
          : resolution >= highest
            ? sizeBytes
            : Math.round(sizeBytes * Math.min(1, Math.max(0.15, (resolution / highest) ** 1.6)));

      const mirror: MediaMirror = {
        id: `vault-dash-${streamId ?? "stream"}-${resolution}`,
        label: `${label} ${codecLabel}`,
        shortUrl: manifestUrl,
        host: hostOf(manifestUrl),
        source: "vault",
        headers,
      };

      releases.push({
        id: `vault-play-${streamId ?? "stream"}-${resolution}`,
        title: fileName,
        fileName,
        quality: label,
        size: scaledSize ? formatBytes(scaledSize) : undefined,
        sizeBytes: scaledSize,
        container: format.toLowerCase(),
        languages: undefined,
        tags: [codecLabel],
        isPack: false,
        seasonNumber: season > 0 ? season : undefined,
        episodeNumber: episode > 0 ? episode : undefined,
        mirrors: [mirror],
      });
    }
  }

  return releases;
}

/** A downloadable resource entry (direct file link). */
export function resourceItemToRelease(value: unknown): MediaReleaseItem | null {
  const item = asRecord(value);
  if (!item) return null;

  const fileName = str(item.fileName ?? item.title) ?? "Unknown release";
  const resolutionValue = item.resolution;
  const quality =
    typeof resolutionValue === "number"
      ? `${resolutionValue}p`
      : str(resolutionValue) ?? undefined;
  const codec = str(item.codecName ?? item.codec) ?? undefined;
  const language = str(item.language ?? item.lanName) ?? undefined;
  const sizeBytes = num(item.size) ?? undefined;
  const seasonNumber = num(item.se) ?? undefined;
  const episodeNumber = num(item.ep) ?? undefined;
  const resourceId = subjectIdOf(item);

  const link = str(item.resourceLink ?? item.url);
  if (!link || !link.trim() || isDeprecationNoticeUrl(link)) return null;

  const label = str(item.uploadBy ?? item.source) ?? "Direct";
  const mirror: MediaMirror = {
    id: `vault-file-${resourceId ?? fileName}`,
    label,
    shortUrl: link,
    host: hostOf(link),
    source: "vault",
  };

  return {
    id: `vault-resource-${resourceId ?? fileName}`,
    title: fileName,
    fileName,
    quality,
    size: sizeBytes ? formatBytes(sizeBytes) : undefined,
    sizeBytes,
    container: extensionOf(fileName),
    languages: language,
    tags: codec ? [codec] : undefined,
    isPack: false,
    seasonNumber,
    episodeNumber,
    mirrors: [mirror],
  };
}

/** Recovered direct file (from the failover endpoint) — plain link, no signed cookie. */
export function markReleaseAsDirectFile(release: MediaReleaseItem): MediaReleaseItem {
  return {
    ...release,
    mirrors: release.mirrors.map((mirror) => ({ ...mirror })),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function extensionOf(fileName: string): string | undefined {
  const match = fileName.match(/\.([a-z0-9]{2,4})$/i);
  return match ? match[1].toLowerCase() : undefined;
}

/** Human-readable size, mirroring the reference client's formatting. */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  const mb = bytes / 1024 ** 2;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
