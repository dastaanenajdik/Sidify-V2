/**
 * Internet Archive catalogue helpers (framework-free).
 *
 * The Internet Archive (archive.org) is a real, lawful source of films that are in the
 * public domain or published under an open licence. This module turns its Scrape-API
 * documents into `MediaTitle`s, builds the Lucene queries the `/advancedsearch.php`
 * endpoint expects, and keeps a small verified snapshot of openly available features so
 * the shelf still renders when archive.org cannot be reached at request time.
 *
 * Nothing here scrapes third-party file hosts: identifiers come from archive.org and
 * playback is archive.org's own embed player / download endpoints.
 */

import type { Genre, MediaKind, MediaQuery, MediaSort, MediaTitle } from "./types";

export const ARCHIVE_BASE = "https://archive.org";
export const ARCHIVE_SEARCH_URL = `${ARCHIVE_BASE}/advancedsearch.php`;
export const ARCHIVE_META_URL = `${ARCHIVE_BASE}/metadata`;

/** Slugs for archive titles carry this prefix so the router knows who owns them. */
export const ARCHIVE_SLUG_PREFIX = "ia-";

/** Collections we are willing to serve: openly available film & TV collections. */
export const MOVIE_COLLECTIONS = [
  "feature_films",
  "film_noir",
  "sci-fi_horror",
  "silent_films",
  "classic_cartoons",
  "moviesandfilms",
] as const;

/** A document as returned by archive.org's Scrape API (only the fields we use). */
export interface ArchiveDoc {
  identifier?: string;
  title?: string | string[];
  year?: string | number;
  date?: string;
  description?: string | string[];
  genre?: string | string[];
  subject?: string | string[];
  language?: string | string[];
  runtime?: string | number;
  downloads?: number;
  avg_rating?: number;
  creator?: string | string[];
}

export interface ArchiveSearchResponse {
  response?: {
    numFound?: number;
    start?: number;
    docs?: ArchiveDoc[];
  };
}

/* ------------------------------- addresses ------------------------------- */

export function archiveSlug(identifier: string): string {
  return `${ARCHIVE_SLUG_PREFIX}${identifier}`;
}

/** `ia-his_girl_friday` → `his_girl_friday`; anything else → null. */
export function archiveIdentifier(slug: string): string | null {
  let value = slug;
  try {
    value = decodeURIComponent(slug);
  } catch {
    /* keep the raw slug */
  }
  if (!value.startsWith(ARCHIVE_SLUG_PREFIX)) return null;
  const identifier = value.slice(ARCHIVE_SLUG_PREFIX.length).trim();
  // Archive identifiers are URL-safe; reject anything that could escape the path.
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(identifier) ? identifier : null;
}

export function isArchiveSlug(slug: string): boolean {
  return archiveIdentifier(slug) !== null;
}

export const archivePosterUrl = (identifier: string): string =>
  `${ARCHIVE_BASE}/services/img/${encodeURIComponent(identifier)}`;

export const archiveDetailsUrl = (identifier: string): string =>
  `${ARCHIVE_BASE}/details/${encodeURIComponent(identifier)}`;

export const archiveDownloadUrl = (identifier: string): string =>
  `${ARCHIVE_BASE}/download/${encodeURIComponent(identifier)}`;

export const archiveEmbedUrl = (identifier: string): string =>
  `${ARCHIVE_BASE}/embed/${encodeURIComponent(identifier)}`;

/** Direct playable file, only built from a name the archive itself reported. */
export function archiveFileUrl(identifier: string, fileName: string): string {
  return `${archiveDownloadUrl(identifier)}/${encodeURIComponent(fileName).replace(/%2F/gi, "/")}`;
}

/* -------------------------------- parsing -------------------------------- */

export function stripHtml(input: string | undefined): string {
  if (!input) return "";
  return input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const firstString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value.find((entry) => entry && entry.trim()) : value;

export function archiveOverview(doc: ArchiveDoc, limit = 700): string {
  const text = stripHtml(firstString(doc.description));
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${(stop > 240 ? cut.slice(0, stop + 1) : cut).trim()}…`;
}

export function parseArchiveYear(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1880 && value <= new Date().getFullYear() + 2 ? Math.floor(value) : undefined;
  }
  const match = String(value ?? "").match(/(18|19|20)\d{2}/);
  if (!match) return undefined;
  const year = Number(match[0]);
  return year >= 1880 && year <= new Date().getFullYear() + 2 ? year : undefined;
}

/** `"01:15:00"`, `"1h 15m"`, `"75 min"` or `75` minutes → 75. */
export function parseArchiveRuntime(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? Math.round(value) : undefined;
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const clock = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    // HH:MM:SS or MM:SS — the seconds field only refines, it never changes the minutes.
    const minutes = Number(clock[1]) * 60 + Number(clock[2]);
    return minutes > 0 ? minutes : undefined;
  }
  const hours = raw.match(/(\d+)\s*(?:h|hr|hour)/i);
  const minutes = raw.match(/(\d+)\s*(?:m|min)/i);
  if (hours || minutes) return (Number(hours?.[1] ?? 0) || 0) * 60 + (Number(minutes?.[1] ?? 0) || 0);
  const bare = raw.match(/^\d+$/);
  return bare ? Number(raw) : undefined;
}

/* -------------------------------- genres --------------------------------- */

const GENRES: Record<string, Genre> = {
  action: { id: "action", name: "Action" },
  adventure: { id: "adventure", name: "Adventure" },
  animation: { id: "animation", name: "Animation" },
  comedy: { id: "comedy", name: "Comedy" },
  crime: { id: "crime", name: "Crime" },
  documentary: { id: "documentary", name: "Documentary" },
  drama: { id: "drama", name: "Drama" },
  family: { id: "family", name: "Family" },
  fantasy: { id: "fantasy", name: "Fantasy" },
  "film-noir": { id: "film-noir", name: "Film-Noir" },
  horror: { id: "horror", name: "Horror" },
  musical: { id: "musical", name: "Musical" },
  mystery: { id: "mystery", name: "Mystery" },
  romance: { id: "romance", name: "Romance" },
  "sci-fi": { id: "sci-fi", name: "Sci-Fi" },
  short: { id: "short", name: "Short" },
  thriller: { id: "thriller", name: "Thriller" },
  war: { id: "war", name: "War" },
  western: { id: "western", name: "Western" },
};

const GENRE_ALIASES: Record<string, string> = {
  action: "action",
  adventure: "adventure",
  animation: "animation",
  "animated": "animation",
  "cartoon": "animation",
  "cartoons": "animation",
  comedy: "comedy",
  crime: "crime",
  documentary: "documentary",
  drama: "drama",
  family: "family",
  fantasy: "fantasy",
  "film noir": "film-noir",
  "film-noir": "film-noir",
  noir: "film-noir",
  horror: "horror",
  music: "musical",
  musical: "musical",
  mystery: "mystery",
  romance: "romance",
  "sci fi": "sci-fi",
  "sci-fi": "sci-fi",
  "science fiction": "sci-fi",
  "science-fiction": "sci-fi",
  "short": "short",
  "thriller": "thriller",
  war: "war",
  western: "western",
};

/** Archive `genre`/`subject` strings → the catalogue's genre vocabulary. */
export function archiveGenres(doc: ArchiveDoc): Genre[] {
  const raw = [doc.genre, doc.subject].flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []));
  const out: Genre[] = [];
  for (const entry of raw) {
    for (const part of String(entry).split(/[,;/|]/)) {
      const key = part.trim().toLowerCase();
      const id = GENRE_ALIASES[key];
      if (!id) continue;
      const genre = GENRES[id];
      if (genre && !out.some((g) => g.id === genre.id)) out.push(genre);
    }
  }
  return out;
}

/** The genre vocabulary used for archive filters (subset with stable ids). */
export function archiveGenreList(): Genre[] {
  return Object.values(GENRES).sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------- languages ------------------------------- */

const LANGUAGES: Record<string, { code: string; name: string }> = {
  eng: { code: "en", name: "English" },
  english: { code: "en", name: "English" },
  hin: { code: "hi", name: "Hindi" },
  hindi: { code: "hi", name: "Hindi" },
  spa: { code: "es", name: "Spanish" },
  spanish: { code: "es", name: "Spanish" },
  fre: { code: "fr", name: "French" },
  fra: { code: "fr", name: "French" },
  french: { code: "fr", name: "French" },
  ger: { code: "de", name: "German" },
  deu: { code: "de", name: "German" },
  german: { code: "de", name: "German" },
  ita: { code: "it", name: "Italian" },
  italian: { code: "it", name: "Italian" },
  por: { code: "pt", name: "Portuguese" },
  portuguese: { code: "pt", name: "Portuguese" },
  jpn: { code: "ja", name: "Japanese" },
  japanese: { code: "ja", name: "Japanese" },
  kor: { code: "ko", name: "Korean" },
  korean: { code: "ko", name: "Korean" },
  chi: { code: "zh", name: "Chinese" },
  zho: { code: "zh", name: "Chinese" },
  chinese: { code: "zh", name: "Chinese" },
  ara: { code: "ar", name: "Arabic" },
  arabic: { code: "ar", name: "Arabic" },
  rus: { code: "ru", name: "Russian" },
  russian: { code: "ru", name: "Russian" },
  tur: { code: "tr", name: "Turkish" },
  turkish: { code: "tr", name: "Turkish" },
  ben: { code: "bn", name: "Bengali" },
  tam: { code: "ta", name: "Tamil" },
  tel: { code: "te", name: "Telugu" },
  mar: { code: "mr", name: "Marathi" },
  mal: { code: "ml", name: "Malayalam" },
  dan: { code: "da", name: "Danish" },
  swe: { code: "sv", name: "Swedish" },
  san: { code: "sa", name: "Sanskrit" },
};

export const ARCHIVE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
];

export function archiveLanguage(raw: string | string[] | undefined): { code: string; name: string } {
  const value = firstString(raw);
  const key = String(value ?? "").trim().toLowerCase();
  if (LANGUAGES[key]) return LANGUAGES[key];
  const code = key.slice(0, 2);
  if (LANGUAGES[code]) return LANGUAGES[code];
  return { code: "en", name: value ? String(value).slice(0, 24) : "English" };
}

/* -------------------------------- mapping -------------------------------- */

/** Archive identifiers are stable and unique, so they are the title id. */
export function archiveDocToTitle(doc: ArchiveDoc): MediaTitle | null {
  const identifier = typeof doc.identifier === "string" ? doc.identifier.trim() : "";
  const title = stripHtml(firstString(doc.title));
  if (!identifier || !title) return null;

  const language = archiveLanguage(doc.language);
  const year = parseArchiveYear(doc.year ?? doc.date);
  const rating = typeof doc.avg_rating === "number" && doc.avg_rating > 0 ? Math.min(10, Math.round(doc.avg_rating * 20) / 10) : undefined;

  return {
    id: identifier,
    slug: archiveSlug(identifier),
    kind: "movie",
    title,
    overview: archiveOverview(doc),
    year,
    genres: archiveGenres(doc),
    language: language.code,
    languageName: language.name,
    rating,
    votes: undefined,
    runtimeMinutes: parseArchiveRuntime(doc.runtime),
    poster: archivePosterUrl(identifier),
    backdrop: null,
    trailer: null,
    popularity: typeof doc.downloads === "number" ? doc.downloads : undefined,
    officialUrl: archiveDetailsUrl(identifier),
    free: true,
    demo: false,
  };
}

/**
 * Playback + download links for an archive item.
 *
 * The embed player never 404s on a renamed derivative file, which is why it is the
 * primary source. Labels are deliberately left empty: the player is presented as part of
 * this site, never as a named third-party server.
 */
export function archivePlaybackSources(identifier: string) {
  return [
    {
      url: archiveEmbedUrl(identifier),
      type: "embed" as const,
      note: "Free, publicly available copy. Print quality and running time can differ from the theatrical release.",
    },
  ];
}

/* -------------------------------- queries -------------------------------- */

/** Strip Lucene metacharacters from user text before it reaches the search API. */
function luceneEscape(input: string): string {
  return input.replace(/[\\+\-!(){}[\]^"~*?:/|&]/g, " ").replace(/\s+/g, " ").trim();
}

const SORT_MAP: Record<MediaSort, string> = {
  trending: "downloads desc",
  newest: "year desc",
  oldest: "year asc",
  rating: "avg_rating desc",
  title: "title asc",
};

export interface ArchiveQuerySpec {
  /** The Lucene `q` value. */
  q: string;
  /** The Scrape-API sort expression. */
  sort: string;
}

/**
 * Translate the catalogue's query into an archive.org advanced-search query.
 * `series` is not supported yet — the provider returns an empty page for it.
 */
export function buildArchiveQuery(query: MediaQuery, options: { exactTitle?: boolean } = {}): ArchiveQuerySpec {
  const clauses: string[] = ["mediatype:movies", `(${MOVIE_COLLECTIONS.map((c) => `collection:"${c}"`).join(" OR ")})`];

  const text = luceneEscape(query.q ?? "");
  if (text) {
    clauses.push(options.exactTitle ? `title:("${text}")` : `(title:("${text}") OR description:("${text}"))`);
  }

  const genre = GENRE_ALIASES[(query.genre ?? "").trim().toLowerCase()];
  if (genre) {
    const name = GENRES[genre].name.replace(/-/g, " ");
    clauses.push(`(subject:("${name}") OR genre:("${name}"))`);
  }

  const year = (query.year ?? "").trim();
  const decade = year.match(/^(\d{3})0s$/);
  if (decade) clauses.push(`year:[${decade[1]}0 TO ${decade[1]}9]`);
  else if (/^\d{4}$/.test(year)) clauses.push(`year:${year}`);

  if (query.language) {
    const language = ARCHIVE_LANGUAGES.find((entry) => entry.code === query.language);
    clauses.push(`language:(${language ? `"${language.code.toUpperCase()}" OR "${language.name}"` : `"${luceneEscape(query.language)}"`})`);
  }

  return {
    q: clauses.join(" AND "),
    sort: SORT_MAP[query.sort ?? "trending"] ?? SORT_MAP.trending,
  };
}

export function archiveSearchParams(q: string, page: number, rows: number, sort: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("q", q);
  for (const field of ["identifier", "title", "year", "date", "description", "genre", "subject", "language", "runtime", "downloads", "avg_rating"]) {
    params.append("fl[]", field);
  }
  params.set("sort[]", sort);
  params.set("rows", String(rows));
  params.set("page", String(Math.max(1, Math.floor(page))));
  params.set("output", "json");
  return params;
}

/** Query used to find a specific film, for matching a metadata title to a free copy. */
export function archiveMatchQuery(title: string, year?: number): string {
  const safe = luceneEscape(title);
  const parts = ["mediatype:movies", `(${MOVIE_COLLECTIONS.map((c) => `collection:"${c}"`).join(" OR ")})`];
  if (safe) parts.push(`title:("${safe}")`);
  const decade = year ? Math.floor(year / 10) * 10 : null;
  if (year && decade !== null) parts.push(`year:[${decade} TO ${decade + 9}]`);
  return parts.join(" AND ");
}

export function archiveMatchScore(candidate: MediaTitle, title: string, year?: number): number {
  const norm = (input: string) =>
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const wanted = norm(title);
  const found = norm(candidate.title);
  if (!wanted || !found) return 0;
  let score = 0;
  if (wanted === found) score += 6;
  else if (found.replace(/\b(the|a|an)\b/g, "").trim() === wanted.replace(/\b(the|a|an)\b/g, "").trim()) score += 5;
  else if (found.includes(wanted) || wanted.includes(found)) score += 2;
  else return 0;
  if (year && candidate.year) {
    const delta = Math.abs(candidate.year - year);
    if (delta === 0) score += 4;
    else if (delta <= 1) score += 2;
    else return 0;
  }
  return score;
}

export const MEDIA_KIND_MOVIE: MediaKind = "movie";

/* -------------------------------- snapshot ------------------------------- */

/**
 * A verified snapshot of openly available films from archive.org's `feature_films`
 * collection (identifiers, titles, years and ratings were read from the Scrape API on
 * 2026-10-22). It is the offline fallback: if archive.org cannot be reached the shelf
 * still lists real, playable films instead of placeholders. Live results always win.
 *
 * `overview` strings are short editorial summaries; the live API replaces them with the
 * archive's own description whenever it answers.
 */
export const ARCHIVE_SNAPSHOT: ArchiveDoc[] = [
  {
    identifier: "his_girl_friday",
    title: "His Girl Friday",
    year: 1940,
    genre: "comedy,romance",
    language: "eng",
    downloads: 1_312_020,
    avg_rating: 4.32,
    runtime: "01:32:00",
    description:
      "Howard Hawks' screwball newspaper comedy. Cary Grant plays a scheming editor who will do anything to keep his star reporter and ex-wife (Rosalind Russell) from remarrying — including handing her one last scoop.",
  },
  {
    identifier: "meet_john_doe",
    title: "Meet John Doe",
    year: 1941,
    genre: "drama,romance",
    language: "eng",
    downloads: 508_333,
    avg_rating: 4.8,
    runtime: "02:02:00",
    description:
      "Frank Capra's Depression-era fable: a newspaper invents a everyman who threatens to jump off City Hall on Christmas Eve, then hires a drifter (Gary Cooper) to play him. Barbara Stanwyck co-stars.",
  },
  {
    identifier: "TheStranger_0",
    title: "The Stranger",
    year: 1946,
    genre: "film-noir,thriller",
    language: "eng",
    downloads: 662_151,
    avg_rating: 4.5,
    runtime: "01:35:00",
    description:
      "Orson Welles directs and stars as a Nazi war criminal hiding in a small Connecticut town, with Edward G. Robinson as the war-crimes investigator closing in.",
  },
  {
    identifier: "ScarletStreet",
    title: "Scarlet Street",
    year: 1945,
    genre: "film-noir,drama",
    language: "eng",
    downloads: 523_969,
    avg_rating: 4.18,
    runtime: "01:43:00",
    description:
      "Fritz Lang's noir about a meek cashier and amateur painter (Edward G. Robinson) who is fleeced by a woman and her small-time pimp — until the deception turns lethal.",
  },
  {
    identifier: "CarnivalofSouls",
    title: "Carnival of Souls",
    year: 1962,
    genre: "horror,mystery",
    language: "eng",
    downloads: 473_137,
    avg_rating: 4.34,
    runtime: "01:18:00",
    description:
      "Herk Harvey's low-budget cult horror: the sole survivor of a drag race drowns, walks out of the river, and is drawn to an abandoned lakeside pavilion by figures only she can see.",
  },
  {
    identifier: "house_on_haunted_hill_ipod",
    title: "House on Haunted Hill",
    year: 1959,
    genre: "horror,mystery",
    language: "eng",
    downloads: 1_041_156,
    avg_rating: 4.25,
    runtime: "01:15:00",
    description:
      "Vincent Price offers five strangers $10,000 each to survive a night in a house where every guest has a reason to be afraid — William Castle's gimmick-horror classic.",
  },
  {
    identifier: "DasKabinettdesDoktorCaligariTheCabinetofDrCaligari",
    title: "The Cabinet of Dr. Caligari",
    year: 1919,
    genre: "horror,drama",
    language: "ger",
    downloads: 533_101,
    avg_rating: 4.6,
    runtime: "01:17:00",
    description:
      "Robert Wiene's German Expressionist landmark: a somnambulist under the control of a sinister showman commits murders in a town of painted shadows and crooked streets.",
  },
  {
    identifier: "BattleshipPotemkin",
    title: "Battleship Potemkin",
    year: 1925,
    genre: "drama,war",
    language: "rus",
    downloads: 446_246,
    avg_rating: 4.43,
    runtime: "01:15:00",
    description:
      "Sergei Eisenstein's revolutionary epic, built around the Odessa Steps sequence — one of the most studied passages in film history.",
  },
  {
    identifier: "ThePhantomoftheOpera",
    title: "The Phantom of the Opera",
    year: 1925,
    genre: "horror,drama",
    language: "eng",
    downloads: 626_366,
    avg_rating: 4.38,
    runtime: "01:33:00",
    description:
      "Lon Chaney's disfigured Phantom haunts the Paris Opera and abducts the soprano he has secretly trained. The 1925 silent version of Gaston Leroux's novel.",
  },
  {
    identifier: "lost_world",
    title: "The Lost World",
    year: 1925,
    genre: "adventure,sci-fi",
    language: "eng",
    downloads: 551_459,
    avg_rating: 4.25,
    runtime: "01:04:00",
    description:
      "Professor Challenger leads an expedition to a South American plateau where dinosaurs still roam — the silent-era stop-motion spectacle that led to King Kong.",
  },
  {
    identifier: "GreatExpectations1946",
    title: "Great Expectations",
    year: 1946,
    genre: "drama",
    language: "eng",
    downloads: 438_558,
    avg_rating: 4.77,
    runtime: "01:58:00",
    description:
      "David Lean's adaptation of Dickens: an orphan's rise from the marshes to London society, and the convict who made it possible.",
  },
  {
    identifier: "suddenly",
    title: "Suddenly",
    year: 1954,
    genre: "film-noir,thriller",
    language: "eng",
    downloads: 738_654,
    avg_rating: 4.15,
    runtime: "01:15:00",
    description:
      "Frank Sinatra plays a hired assassin who seizes a family's house to shoot the President from its window. A taut, single-location thriller.",
  },
  {
    identifier: "impact",
    title: "Impact",
    year: 1949,
    genre: "film-noir,crime",
    language: "eng",
    downloads: 496_937,
    avg_rating: 4.53,
    runtime: "01:51:00",
    description:
      "An industrialist survives his wife's murder plot, is mistaken for dead, and starts over as a small-town mechanic — until the truth catches up with him.",
  },
  {
    identifier: "Cyrano_DeBergerac",
    title: "Cyrano de Bergerac",
    year: 1950,
    genre: "drama,romance",
    language: "eng",
    downloads: 492_606,
    avg_rating: 4.53,
    runtime: "01:52:00",
    description:
      "José Ferrer won an Oscar for his swaggering, heartbroken Cyrano, who writes love letters for another man to the woman he himself adores.",
  },
  {
    identifier: "secret_weapon",
    title: "Sherlock Holmes and the Secret Weapon",
    year: 1943,
    genre: "mystery,crime",
    language: "eng",
    downloads: 445_594,
    avg_rating: 4.36,
    runtime: "01:08:00",
    description:
      "Basil Rathbone and Nigel Bruce race Professor Moriarty to a stolen bombsight, in a wartime mystery directed by Roy William Neill.",
  },
  {
    identifier: "dressed_to_kill",
    title: "Dressed to Kill",
    year: 1946,
    genre: "mystery,crime",
    language: "eng",
    downloads: 795_083,
    avg_rating: 4.33,
    runtime: "01:12:00",
    description:
      "Sherlock Holmes follows a trail of music boxes to bank plates hidden by a convicted forger — one of the last Rathbone/Bruce Holmes films.",
  },
  {
    identifier: "Horror_Express",
    title: "Horror Express",
    year: 1973,
    genre: "horror,sci-fi",
    language: "eng",
    downloads: 489_232,
    avg_rating: 4.2,
    runtime: "01:28:00",
    description:
      "A frozen prehistoric specimen comes alive on the Trans-Siberian Express. Christopher Lee, Peter Cushing and Telly Savalas in a cult favourite.",
  },
  {
    identifier: "teenagers_from_outerspace",
    title: "Teenagers from Outer Space",
    year: 1959,
    genre: "sci-fi,horror",
    language: "eng",
    downloads: 411_602,
    avg_rating: 4.27,
    runtime: "01:26:00",
    description:
      "An alien mission to raise giant land lobsters on Earth goes wrong when one crewman rebels. Endearingly earnest drive-in science fiction.",
  },
  {
    identifier: "penny_serenade",
    title: "Penny Serenade",
    year: 1941,
    genre: "drama,romance",
    language: "eng",
    downloads: 399_174,
    avg_rating: 4.58,
    runtime: "01:59:00",
    description:
      "George Stevens' tearjerker: a couple (Irene Dunne and Cary Grant) recall their marriage and the child they adopted, as their newsprint business collapses.",
  },
  {
    identifier: "AfricaScreams",
    title: "Africa Screams",
    year: 1949,
    genre: "comedy,adventure",
    language: "eng",
    downloads: 370_533,
    avg_rating: 4.0,
    runtime: "01:19:00",
    description:
      "Bud Abbott and Lou Costello bumble through the jungle in search of diamonds, with a cast that includes Shemp Howard and a young Buddy Hackett.",
  },
  {
    identifier: "angel_on_my_shoulder",
    title: "Angel on My Shoulder",
    year: 1946,
    genre: "fantasy,drama",
    language: "eng",
    downloads: 338_754,
    avg_rating: 4.39,
    runtime: "01:41:00",
    description:
      "A murdered gangster is sent back to Earth in the body of a judge by the Devil, who is hoping to prove that good and evil are only a matter of circumstances.",
  },
  {
    identifier: "markofzorro-1920",
    title: "The Mark of Zorro",
    year: 1920,
    genre: "adventure,action",
    language: "eng",
    downloads: 338_001,
    avg_rating: 4.0,
    runtime: "01:30:00",
    description:
      "Douglas Fairbanks as the swashbuckling masked defender of old California — the silent film that defined the Zorro legend on screen.",
  },
  {
    identifier: "TheGhoul",
    title: "The Ghoul",
    year: 1933,
    genre: "horror",
    language: "eng",
    downloads: 426_896,
    avg_rating: 4.08,
    runtime: "01:20:00",
    description:
      "Boris Karloff, dying and desperate, will be buried with a cursed jewel — and his household will kill for it. A British gothic chiller.",
  },
  {
    identifier: "AsYouLikeIt1936",
    title: "As You Like It",
    year: 1936,
    genre: "comedy,drama",
    language: "eng",
    downloads: 524_697,
    avg_rating: 4.67,
    runtime: "01:36:00",
    description:
      "Shakespeare's Forest of Arden on screen, with Laurence Olivier and Elisabeth Bergner, in a lush 1930s British production.",
  },
  {
    identifier: "little_princess",
    title: "The Little Princess",
    year: 1939,
    genre: "family,drama",
    language: "eng",
    downloads: 505_620,
    avg_rating: 4.13,
    runtime: "01:34:00",
    description:
      "Shirley Temple in Technicolor as a girl sent to a London boarding school when her father goes to war, then forced into service when he is reported missing.",
  },
  {
    identifier: "amazing_adventure",
    title: "The Amazing Adventure",
    year: 1936,
    genre: "comedy,romance",
    language: "eng",
    downloads: 414_594,
    avg_rating: 4.29,
    runtime: "01:16:00",
    description:
      "A wealthy young man bets his doctors he can survive a year with no money. Cary Grant in a British comedy of manners.",
  },
  {
    identifier: "my_favorite_brunette",
    title: "My Favorite Brunette",
    year: 1947,
    genre: "comedy,mystery",
    language: "eng",
    downloads: 638_876,
    avg_rating: 4.41,
    runtime: "01:27:00",
    description:
      "Bob Hope spoofs private-eye pictures as a baby photographer who is mistaken for a detective, with Dorothy Lamour and Peter Lorre.",
  },
  {
    identifier: "Sita_Sings_the_Blues",
    title: "Sita Sings the Blues",
    year: 2008,
    genre: "animation,musical,comedy",
    language: "eng",
    downloads: 945_076,
    avg_rating: 4.62,
    runtime: "01:22:00",
    description:
      "Nina Paley's animated Ramayana, told through 1920s jazz vocals and three narrators — released free under Creative Commons.",
  },
  {
    identifier: "Haxan_tinted_and_subtitled",
    title: "Häxan",
    year: 1922,
    genre: "documentary,horror",
    language: "eng",
    downloads: 358_825,
    avg_rating: 4.27,
    runtime: "01:45:00",
    description:
      "Benjamin Christensen's essay film on witchcraft and hysteria, mixing dramatised sabbaths with documentary asides — unsettling a century later.",
  },
  {
    identifier: "WarOfTheWildcats-JohnWayne1943",
    title: "War of the Wildcats",
    year: 1943,
    genre: "western,action",
    language: "eng",
    downloads: 379_577,
    avg_rating: 4.5,
    runtime: "01:42:00",
    description:
      "John Wayne takes on an oil baron in the Oklahoma land rush. Also known as In Old Oklahoma.",
  },
  {
    identifier: "texas_terror_1935",
    title: "Texas Terror",
    year: 1935,
    genre: "western",
    language: "eng",
    downloads: 355_960,
    avg_rating: 4.0,
    runtime: "00:52:00",
    description:
      "A sheriff who believes he killed his best friend hands in his badge and becomes a prospector — John Wayne in a Lone Star Western.",
  },
  {
    identifier: "TheFastandtheFuriousJohnIreland1954goofyrip",
    title: "The Fast and the Furious",
    year: 1954,
    genre: "action,crime",
    language: "eng",
    downloads: 1_476_964,
    avg_rating: 3.5,
    runtime: "01:13:00",
    description:
      "An innocent man escapes jail and takes a sports-car racer hostage, fleeing into a cross-border road race. The 1954 B-movie that lent its title to the later series.",
  },
  {
    identifier: "charlie_chaplin_film_fest",
    title: "Charlie Chaplin Festival",
    year: 1938,
    genre: "comedy",
    language: "eng",
    downloads: 1_508_688,
    avg_rating: 4.52,
    runtime: "01:20:00",
    description:
      "Four Chaplin shorts from 1917 — The Adventurer, The Cure, Easy Street and The Immigrant — presented together with music and sound effects.",
  },
  {
    identifier: "VoyagetothePlanetofPrehistoricWomen",
    title: "Voyage to the Planet of Prehistoric Women",
    year: 1967,
    genre: "sci-fi,adventure",
    language: "eng",
    downloads: 1_161_645,
    avg_rating: 3.38,
    runtime: "01:18:00",
    description:
      "American footage grafted onto the Soviet Planeta Bur: astronauts crash on Venus and meet its telepathic inhabitants.",
  },
  {
    identifier: "Great_Guy.avi",
    title: "Great Guy",
    year: 1936,
    genre: "crime,drama",
    language: "eng",
    downloads: 384_793,
    avg_rating: 4.29,
    runtime: "01:06:00",
    description:
      "James Cagney as a department-store investigator who takes on a protection racket running through the city's markets.",
  },
  {
    identifier: "TheOvertheHillGang",
    title: "The Over-the-Hill Gang",
    year: 1969,
    genre: "western,comedy",
    language: "eng",
    downloads: 364_187,
    avg_rating: 4.5,
    runtime: "01:15:00",
    description:
      "A retired Texas Ranger reassembles his ageing crew to clean up a town. A geriatric western comedy with Walter Brennan, Pat O'Brien and Chill Wills.",
  },
  {
    identifier: "Horror_Hotel",
    title: "City of the Dead (Horror Hotel)",
    year: 1960,
    genre: "horror,mystery",
    language: "eng",
    downloads: 339_318,
    avg_rating: 4.24,
    runtime: "01:16:00",
    description:
      "A student researching witch trials travels to a fogbound Massachusetts village and checks into an inn run by a coven. Christopher Lee co-stars.",
  },
  {
    identifier: "mclintok_widescreen",
    title: "McLintock!",
    year: 1963,
    genre: "western,comedy",
    language: "eng",
    downloads: 652_691,
    avg_rating: 4.0,
    runtime: "02:07:00",
    description:
      "John Wayne as a cattle baron whose estranged wife returns to take their daughter — and him — in hand. A broad, brawling western comedy with Maureen O'Hara.",
  },
  {
    identifier: "JungleBook",
    title: "Jungle Book",
    year: 1942,
    genre: "adventure,family",
    language: "eng",
    downloads: 1_016_736,
    avg_rating: 3.71,
    runtime: "01:48:00",
    description:
      "The Korda production of Kipling's Mowgli stories, shot in Technicolor with Sabu as the boy raised by wolves.",
  },
  {
    identifier: "behave_yourself_ipod",
    title: "Behave Yourself",
    year: 1951,
    genre: "comedy,crime",
    language: "eng",
    downloads: 341_306,
    avg_rating: 4.25,
    runtime: "01:21:00",
    description:
      "A small-time crook adopts a dog that happens to be a smuggler's courier, and every gangster in town comes looking for it.",
  },
];

/** Snapshot as titles, deduped and ordered by popularity (used whenever the API is down). */
export function archiveSnapshotTitles(): MediaTitle[] {
  const seen = new Set<string>();
  const out: MediaTitle[] = [];
  for (const doc of ARCHIVE_SNAPSHOT) {
    const title = archiveDocToTitle(doc);
    if (!title || seen.has(title.id)) continue;
    seen.add(title.id);
    out.push(title);
  }
  return out.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}
