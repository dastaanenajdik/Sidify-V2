/**
 * DEMO CATALOGUE — placeholder data, not real titles.
 *
 * No licensed movie/series API is configured by default, so the demo provider serves
 * this catalogue instead: clearly fictional titles, original synopses and generated
 * artwork. Every entry has `demo: true` and the UI badges it as such. Nothing here
 * points at a stream, download or third-party catalogue page.
 *
 * Once `TMDB_API_KEY` / `TMDB_READ_ACCESS_TOKEN` is set, `getMediaProvider()` switches
 * to the TMDb adapter and this file is only used as a fallback.
 */

import type { Episode, Genre, MediaTitle, Season } from "./types";

const G = {
  action: { id: "action", name: "Action" },
  adventure: { id: "adventure", name: "Adventure" },
  animation: { id: "animation", name: "Animation" },
  comedy: { id: "comedy", name: "Comedy" },
  crime: { id: "crime", name: "Crime" },
  documentary: { id: "documentary", name: "Documentary" },
  drama: { id: "drama", name: "Drama" },
  family: { id: "family", name: "Family" },
  fantasy: { id: "fantasy", name: "Fantasy" },
  horror: { id: "horror", name: "Horror" },
  mystery: { id: "mystery", name: "Mystery" },
  romance: { id: "romance", name: "Romance" },
  scifi: { id: "science-fiction", name: "Sci-Fi" },
  thriller: { id: "thriller", name: "Thriller" },
} satisfies Record<string, Genre>;

export const DEMO_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
];

const LANG = Object.fromEntries(DEMO_LANGUAGES.map((l) => [l.code, l.name])) as Record<string, string>;

type DemoSeed = Omit<MediaTitle, "kind" | "languageName" | "demo"> & {
  /** Placeholder language name is filled in from the code. */
  languageName?: string;
};

function movie(seed: Omit<DemoSeed, "kind" | "slug"> & { slug?: string }): MediaTitle {
  return {
    ...seed,
    slug: seed.slug ?? slugOf(seed.title),
    kind: "movie",
    languageName: LANG[seed.language] ?? seed.language.toUpperCase(),
    demo: true,
  } as MediaTitle;
}

function series(seed: Omit<DemoSeed, "kind" | "slug"> & { slug?: string }): MediaTitle {
  return {
    ...seed,
    slug: seed.slug ?? slugOf(seed.title),
    kind: "series",
    languageName: LANG[seed.language] ?? seed.language.toUpperCase(),
    demo: true,
  } as MediaTitle;
}

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const DEMO_MOVIES: MediaTitle[] = [
  movie({
    id: "demo-m-1",
    title: "Neon Monsoon",
    tagline: "When the rain stops, the city starts talking.",
    overview:
      "A rain-soaked city, a signal analyst who hears patterns nobody else can, and forty-eight hours before the last storm of the season rewrites every record she has been keeping.",
    year: 2024,
    releaseDate: "2024-08-16",
    genres: [G.scifi, G.thriller, G.drama],
    language: "en",
    rating: 8.1,
    votes: 18400,
    runtimeMinutes: 118,
    certification: "15",
    accent: "#4f7cf7",
    popularity: 98,
  }),
  movie({
    id: "demo-m-2",
    title: "The Quiet Orbit",
    overview:
      "Two engineers spend eleven months alone on a research station, cataloguing the silence. Their only company is a voice on a delayed channel that may not belong to anyone.",
    year: 2023,
    releaseDate: "2023-11-02",
    genres: [G.scifi, G.drama, G.mystery],
    language: "en",
    rating: 7.8,
    votes: 9200,
    runtimeMinutes: 132,
    accent: "#3f6f8f",
    popularity: 87,
  }),
  movie({
    id: "demo-m-3",
    title: "Chandni Chowk Express",
    overview:
      "A caterer with a failing shop boards the wrong train and ends up cooking for a wedding party that has been waiting forty years for the right guest.",
    year: 2022,
    releaseDate: "2022-03-11",
    genres: [G.comedy, G.drama, G.family],
    language: "hi",
    rating: 7.4,
    votes: 26100,
    runtimeMinutes: 126,
    accent: "#c9772f",
    popularity: 91,
  }),
  movie({
    id: "demo-m-4",
    title: "Saanjh",
    tagline: "Some evenings take years to end.",
    overview:
      "A translator returns to her childhood town to sell the family house and finds the letters she never posted, still waiting in the same drawer.",
    year: 2021,
    releaseDate: "2021-09-24",
    genres: [G.romance, G.drama],
    language: "hi",
    rating: 7.9,
    votes: 14800,
    runtimeMinutes: 112,
    accent: "#b0546e",
    popularity: 76,
  }),
  movie({
    id: "demo-m-5",
    title: "Paper Lanterns",
    overview:
      "A young lamplighter follows a lost lantern through a festival town and discovers the neighbours she has spent a lifetime avoiding.",
    year: 2020,
    releaseDate: "2020-07-18",
    genres: [G.animation, G.family, G.fantasy],
    language: "ja",
    rating: 8.4,
    votes: 39500,
    runtimeMinutes: 104,
    certification: "U",
    accent: "#e0873a",
    popularity: 84,
  }),
  movie({
    id: "demo-m-6",
    title: "Blue Hour",
    overview:
      "Between the last metro and the first bakery delivery, a night porter and a florist agree to tell each other one true thing before sunrise.",
    year: 2019,
    releaseDate: "2019-05-30",
    genres: [G.romance, G.drama],
    language: "fr",
    rating: 7.6,
    votes: 7600,
    runtimeMinutes: 98,
    accent: "#3a5f9e",
    popularity: 62,
  }),
  movie({
    id: "demo-m-7",
    title: "Seoul Static",
    overview:
      "A radio producer starts hearing tomorrow's traffic reports. Proving it is easy; surviving what the broadcast asks her to do is not.",
    year: 2024,
    releaseDate: "2024-10-04",
    genres: [G.thriller, G.mystery, G.crime],
    language: "ko",
    rating: 7.2,
    votes: 22300,
    runtimeMinutes: 121,
    certification: "18",
    accent: "#7b4bd0",
    popularity: 95,
  }),
  movie({
    id: "demo-m-8",
    title: "El Río Dormido",
    overview:
      "A hydrologist mapping a drying river finds a village that only appears in the paperwork of people who have stopped looking for it.",
    year: 2018,
    releaseDate: "2018-02-15",
    genres: [G.drama, G.mystery],
    language: "es",
    rating: 7.7,
    votes: 5400,
    runtimeMinutes: 135,
    accent: "#4a8a72",
    popularity: 54,
  }),
  movie({
    id: "demo-m-9",
    title: "Copper Sky",
    overview:
      "A cargo pilot with one working engine and a hold full of medicine flies the long way around a closed border.",
    year: 2023,
    releaseDate: "2023-06-23",
    genres: [G.action, G.adventure, G.thriller],
    language: "en",
    rating: 6.9,
    votes: 31700,
    runtimeMinutes: 128,
    accent: "#a85c33",
    popularity: 89,
  }),
  movie({
    id: "demo-m-10",
    title: "Small Hours",
    overview:
      "Four night-shift workers in the same building, four lives that never overlap, and one elevator that keeps bringing them to the same floor.",
    year: 2022,
    releaseDate: "2022-01-21",
    genres: [G.drama],
    language: "en",
    rating: 8.0,
    votes: 6900,
    runtimeMinutes: 109,
    accent: "#556b7d",
    popularity: 70,
  }),
  movie({
    id: "demo-m-11",
    title: "The Glass Orchard",
    overview:
      "A greenhouse keeper grows fruit that keeps a memory attached to it — and a detective who wants one of those memories back.",
    year: 2017,
    releaseDate: "2017-09-08",
    genres: [G.mystery, G.thriller, G.drama],
    language: "en",
    rating: 7.5,
    votes: 11200,
    runtimeMinutes: 116,
    accent: "#4a7a5f",
    popularity: 58,
  }),
  movie({
    id: "demo-m-12",
    title: "Raat Baaki",
    tagline: "The night is not over. Neither is he.",
    overview:
      "A wedding planner has until dawn to find out who rewrote the guest list, while the city outside keeps handing her people she thought she knew.",
    year: 2024,
    releaseDate: "2024-04-12",
    genres: [G.thriller, G.mystery, G.crime],
    language: "hi",
    rating: 7.1,
    votes: 27900,
    runtimeMinutes: 118,
    accent: "#8f3b6e",
    popularity: 93,
  }),
  movie({
    id: "demo-m-13",
    title: "Kite Season",
    overview:
      "Every winter a rooftops-wide kite war decides the neighbourhood champion. This year the youngest competitor has the oldest plans.",
    year: 2016,
    releaseDate: "2016-12-09",
    genres: [G.family, G.drama, G.comedy],
    language: "hi",
    rating: 8.2,
    votes: 30100,
    runtimeMinutes: 107,
    accent: "#d1913a",
    popularity: 73,
  }),
  movie({
    id: "demo-m-14",
    title: "Midnight Ramen",
    overview:
      "A chef who only opens after midnight feeds a street of insomniacs, and quietly keeps a bowl warm for someone who stopped coming years ago.",
    year: 2021,
    releaseDate: "2021-02-26",
    genres: [G.comedy, G.drama],
    language: "ja",
    rating: 7.8,
    votes: 15800,
    runtimeMinutes: 101,
    accent: "#b5703f",
    popularity: 68,
  }),
  movie({
    id: "demo-m-15",
    title: "Static Bloom",
    overview:
      "A greenhouse on Mars, a botanist's last broadcast home, and a flower that grows only when someone is listening.",
    year: 2025,
    releaseDate: "2025-03-14",
    genres: [G.scifi, G.drama],
    language: "en",
    rating: 6.8,
    votes: 4100,
    runtimeMinutes: 113,
    accent: "#3f8a8a",
    popularity: 81,
  }),
  movie({
    id: "demo-m-16",
    title: "The Longest Ferry",
    overview:
      "Three strangers share a nine-hour crossing with a car neither of them owns and a story that has to be finished before the harbour.",
    year: 2015,
    releaseDate: "2015-08-07",
    genres: [G.adventure, G.drama, G.mystery],
    language: "en",
    rating: 8.5,
    votes: 20700,
    runtimeMinutes: 141,
    accent: "#2f6f8f",
    popularity: 65,
  }),
  movie({
    id: "demo-m-17",
    title: "Monsoon Letters",
    overview:
      "A postwoman walks the same flooded route for thirty years. The letters change; the house she avoids never does.",
    year: 2020,
    releaseDate: "2020-06-19",
    genres: [G.romance, G.drama],
    language: "hi",
    rating: 7.3,
    votes: 12400,
    runtimeMinutes: 124,
    accent: "#6d5a8f",
    popularity: 60,
  }),
  movie({
    id: "demo-m-18",
    title: "Harbour Lights",
    overview:
      "A lighthouse keeper and a marine cartographer disagree about everything except the one ship that never shows up on either of their charts.",
    year: 2014,
    releaseDate: "2014-10-17",
    genres: [G.drama, G.romance],
    language: "fr",
    rating: 8.1,
    votes: 9700,
    runtimeMinutes: 120,
    accent: "#355f86",
    popularity: 49,
  }),
  movie({
    id: "demo-m-19",
    title: "Deep Field",
    overview:
      "A year with the astronomers who point the largest telescopes at absolutely nothing — and find the oldest light there is.",
    year: 2024,
    releaseDate: "2024-01-26",
    genres: [G.documentary],
    language: "en",
    rating: 8.7,
    votes: 5200,
    runtimeMinutes: 92,
    accent: "#3d4f9e",
    popularity: 66,
  }),
  movie({
    id: "demo-m-20",
    title: "Wildwood",
    overview:
      "A city kid, a stubborn fox and a forest that keeps rearranging itself so nobody can map the way home.",
    year: 2019,
    releaseDate: "2019-11-22",
    genres: [G.animation, G.family, G.adventure],
    language: "en",
    rating: 7.9,
    votes: 43200,
    runtimeMinutes: 96,
    certification: "U",
    accent: "#5c8a3f",
    popularity: 86,
  }),
];

export const DEMO_SERIES: MediaTitle[] = [
  series({
    id: "demo-s-1",
    title: "The Lantern District",
    tagline: "Every street keeps one secret. This one keeps twelve.",
    overview:
      "A city archivist and a night-shift tram driver piece together why an entire district disappears from the maps for one week each winter.",
    year: 2022,
    releaseDate: "2022-09-02",
    genres: [G.mystery, G.drama, G.thriller],
    language: "en",
    rating: 8.3,
    votes: 24100,
    runtimeMinutes: 52,
    seasonCount: 3,
    episodeCount: 24,
    status: "Running",
    accent: "#8a6a2f",
    popularity: 96,
  }),
  series({
    id: "demo-s-2",
    title: "Signal & Noise",
    overview:
      "A public broadcaster discovers a frequency that reads back what its listeners are about to do — and the newsroom has to decide what to report.",
    year: 2023,
    releaseDate: "2023-04-14",
    genres: [G.scifi, G.thriller, G.drama],
    language: "en",
    rating: 7.9,
    votes: 18300,
    runtimeMinutes: 48,
    seasonCount: 2,
    episodeCount: 20,
    status: "Running",
    accent: "#3f7fb0",
    popularity: 90,
  }),
  series({
    id: "demo-s-3",
    title: "Mumbai Nights",
    overview:
      "A taxi stand becomes the safest place in the city for people who cannot go home, and the drivers who keep the meter running.",
    year: 2021,
    releaseDate: "2021-06-11",
    genres: [G.crime, G.drama, G.thriller],
    language: "hi",
    rating: 8.0,
    votes: 32700,
    runtimeMinutes: 45,
    seasonCount: 3,
    episodeCount: 27,
    status: "Running",
    accent: "#a83f4f",
    popularity: 94,
  }),
  series({
    id: "demo-s-4",
    title: "Paper Cranes",
    overview:
      "A girl folds a crane for every day her brother is away, and each one carries a small, impossible wish down the river.",
    year: 2020,
    releaseDate: "2020-03-06",
    genres: [G.animation, G.fantasy, G.family],
    language: "ja",
    rating: 8.6,
    votes: 28900,
    runtimeMinutes: 24,
    seasonCount: 2,
    episodeCount: 24,
    status: "Ended",
    accent: "#c46a9a",
    popularity: 85,
  }),
  series({
    id: "demo-s-5",
    title: "Café Minuit",
    overview:
      "The staff of a twenty-four-hour café serve the same regulars every night and learn everything the daytime never hears.",
    year: 2019,
    releaseDate: "2019-01-18",
    genres: [G.comedy, G.drama, G.romance],
    language: "fr",
    rating: 7.7,
    votes: 11400,
    runtimeMinutes: 28,
    seasonCount: 4,
    episodeCount: 32,
    status: "Ended",
    accent: "#9a5f3f",
    popularity: 64,
  }),
  series({
    id: "demo-s-6",
    title: "Han River Blues",
    overview:
      "Two rival ferry operators on the same stretch of river fall for the same person, in the same week, in front of the same passengers.",
    year: 2024,
    releaseDate: "2024-05-24",
    genres: [G.romance, G.drama, G.comedy],
    language: "ko",
    rating: 8.1,
    votes: 26300,
    runtimeMinutes: 62,
    seasonCount: 1,
    episodeCount: 16,
    status: "Running",
    accent: "#3f6fa8",
    popularity: 92,
  }),
  series({
    id: "demo-s-7",
    title: "Under the Banyan",
    overview:
      "Four generations share one courtyard, one kitchen and one very long argument about whose turn it is to water the tree.",
    year: 2018,
    releaseDate: "2018-08-31",
    genres: [G.family, G.drama, G.comedy],
    language: "hi",
    rating: 8.4,
    votes: 35400,
    runtimeMinutes: 38,
    seasonCount: 4,
    episodeCount: 40,
    status: "Ended",
    accent: "#5f8a3f",
    popularity: 79,
  }),
  series({
    id: "demo-s-8",
    title: "Cold Front",
    overview:
      "A weather station on a northern ridge becomes the last place a police inspector can verify an alibi that everyone else wants buried.",
    year: 2023,
    releaseDate: "2023-11-17",
    genres: [G.thriller, G.crime, G.mystery],
    language: "en",
    rating: 7.5,
    votes: 13600,
    runtimeMinutes: 55,
    seasonCount: 2,
    episodeCount: 16,
    status: "Running",
    accent: "#4f6f8f",
    popularity: 83,
  }),
  series({
    id: "demo-s-9",
    title: "Sol y Sombra",
    overview:
      "A family of restorers inherits a theatre where every play they stage starts coming true in the town outside.",
    year: 2022,
    releaseDate: "2022-02-04",
    genres: [G.drama, G.mystery, G.fantasy],
    language: "es",
    rating: 7.8,
    votes: 8900,
    runtimeMinutes: 46,
    seasonCount: 2,
    episodeCount: 18,
    status: "Ended",
    accent: "#c98a2f",
    popularity: 71,
  }),
  series({
    id: "demo-s-10",
    title: "The Archive",
    overview:
      "A documentary crew spends a year inside the world's largest sound archive, restoring recordings nobody has played in a century.",
    year: 2025,
    releaseDate: "2025-02-28",
    genres: [G.documentary],
    language: "en",
    rating: 8.2,
    votes: 3400,
    runtimeMinutes: 44,
    seasonCount: 1,
    episodeCount: 6,
    status: "Running",
    accent: "#6a5f8f",
    popularity: 74,
  }),
];

/** Episodes per season for each demo series (their sum is `episodeCount`). */
export const DEMO_SEASON_LAYOUT: Record<string, number[]> = {
  "the-lantern-district": [8, 8, 8],
  "signal-noise": [10, 10],
  "mumbai-nights": [9, 9, 9],
  "paper-cranes": [12, 12],
  "cafe-minuit": [8, 8, 8, 8],
  "han-river-blues": [16],
  "under-the-banyan": [10, 10, 10, 10],
  "cold-front": [8, 8],
  "sol-y-sombra": [9, 9],
  "the-archive": [6],
};

const EPISODE_TITLES = [
  "First Light",
  "Low Tide",
  "The Ledger",
  "Room 12",
  "A Quiet Frequency",
  "The Long Way Home",
  "Every Other Tuesday",
  "Static",
  "The Guest List",
  "Paper Walls",
  "Northbound",
  "Second Rain",
  "The Understudy",
  "Open Hours",
  "A Small Errand",
  "The Last Stop",
];

const EPISODE_OVERVIEWS = [
  "An old arrangement stops working, and nobody wants to be the one to say it out loud.",
  "A favour is called in. The price turns out to be information, not money.",
  "Two people finally share the same version of the same night — and it is not the one they lived.",
  "A routine night on the route turns into the first real lead in months.",
  "The quiet one speaks, and the room has to decide whether to believe them.",
  "A promise made years ago comes due at the worst possible moment.",
  "Everyone agrees to keep the secret, except the person who already told someone.",
  "What looks like an accident in the morning reads very differently after closing time.",
];

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic seasons + episodes for a demo series. */
export function demoSeasons(seriesTitle: MediaTitle): Season[] {
  const layout = DEMO_SEASON_LAYOUT[seriesTitle.slug] ?? [8];
  const startYear = seriesTitle.year ?? 2020;
  return layout.map((episodeCount, index) => {
    const seasonNumber = index + 1;
    const seed = hash(`${seriesTitle.slug}-${seasonNumber}`);
    const episodes: Episode[] = Array.from({ length: episodeCount }, (_, i) => {
      const n = i + 1;
      const h = hash(`${seriesTitle.slug}-${seasonNumber}-${n}`);
      return {
        id: `${seriesTitle.slug}-s${seasonNumber}e${n}`,
        seasonNumber,
        episodeNumber: n,
        title: EPISODE_TITLES[(h + n) % EPISODE_TITLES.length],
        overview: EPISODE_OVERVIEWS[(h >> 3) % EPISODE_OVERVIEWS.length],
        runtimeMinutes: (seriesTitle.runtimeMinutes ?? 45) + ((h % 7) - 3),
        airDate: `${startYear + index}-${String(((h >> 5) % 12) + 1).padStart(2, "0")}-${String(((h >> 9) % 26) + 1).padStart(2, "0")}`,
        rating: Math.round((((h % 30) + 70) / 10) * 10) / 10,
      };
    });
    return {
      id: `${seriesTitle.slug}-s${seasonNumber}`,
      seasonNumber,
      name: seasonNumber === 1 ? "Season 1" : `Season ${seasonNumber}`,
      overview:
        seasonNumber === 1
          ? `The first ${episodeCount} episodes: how the arrangement began, and who was already keeping count.`
          : `Episodes ${episodeCount} deep, the story widens beyond the people who started it.`,
      airDate: `${startYear + index}-01-01`,
      poster: null,
      episodes,
    };
  });
}

export function demoCatalog(): MediaTitle[] {
  return [...DEMO_MOVIES, ...DEMO_SERIES];
}
