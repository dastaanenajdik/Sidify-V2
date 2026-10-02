/**
 * Deluxe backdrop catalogue.
 *
 * 12 hand-picked "deluxe" artworks (art-deco salons, liquid chrome, neon sunsets,
 * gilded frames, crystal prisms…) that rotate behind the whole app like a slow
 * slideshow. Files live in /public/art as `lux-NN.jpg` (1920×1080) plus a light
 * `lux-NN-sm.jpg` (960×540) that phones download instead.
 */

export interface DeluxeArt {
  /** 1-based id, matches the `lux-NN` file name. */
  id: number;
  label: string;
  src: string;
  srcSmall: string;
}

const ART_LABELS = [
  "Mirror Lounge",
  "Liquid Gold",
  "Silk Water",
  "Neon Sunset",
  "Gilded Bloom",
  "Velvet Stage",
  "Crystal Prism",
  "Cosmic Vinyl",
  "Emerald Deco",
  "Kintsugi Neon",
  "Halo Salon",
  "Iridescence",
];

export const DELUXE_ART: DeluxeArt[] = ART_LABELS.map((label, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    id: i + 1,
    label,
    src: `/art/lux-${n}.jpg`,
    srcSmall: `/art/lux-${n}-sm.jpg`,
  };
});

export const ART_COUNT = DELUXE_ART.length;

/** How long each artwork stays on screen before the next crossfade. */
export const ART_INTERVAL_MS = 11_000;
/** Crossfade duration — must stay in sync with the CSS transition on the layers. */
export const ART_FADE_MS = 1800;

/* ------------------------------- moods -------------------------------- */

export type MoodId = "luxe" | "chill" | "party" | "romance" | "sad" | "workout" | "focus" | "retro";

export interface Mood {
  id: MoodId;
  label: string;
  /** Three tint colours that wash over the artwork while this mood is on. */
  colors: [string, string, string];
}

export const MOODS: Record<MoodId, Mood> = {
  luxe: { id: "luxe", label: "Luxe", colors: ["#f0abfc", "#f59e0b", "#7c3aed"] },
  chill: { id: "chill", label: "Chill", colors: ["#22d3ee", "#38bdf8", "#6366f1"] },
  party: { id: "party", label: "Party", colors: ["#f472b6", "#fb923c", "#a855f7"] },
  romance: { id: "romance", label: "Romance", colors: ["#fb7185", "#f472b6", "#e879f9"] },
  sad: { id: "sad", label: "Late night", colors: ["#60a5fa", "#818cf8", "#334155"] },
  workout: { id: "workout", label: "Energy", colors: ["#f97316", "#ef4444", "#facc15"] },
  focus: { id: "focus", label: "Focus", colors: ["#34d399", "#0ea5e9", "#4f46e5"] },
  retro: { id: "retro", label: "Retro", colors: ["#f472b6", "#fbbf24", "#22d3ee"] },
};

const MOOD_KEYWORDS: Array<{ id: MoodId; words: string[] }> = [
  { id: "sad", words: ["sad", "lofi", "lo-fi", "lone", "heartbreak", "breakup", "cry", "dard", "judai", "tanha", "emo", "rain", "slowed", "reverb"] },
  { id: "romance", words: ["love", "romance", "romantic", "ishq", "pyaar", "pyar", "mohabbat", "dil", "baby", "honey", "kiss", "jaan"] },
  { id: "party", words: ["party", "dance", "club", "remix", "edm", "dj", "festival", "bhangra", "dhol", "nachi", "holi"] },
  { id: "workout", words: ["workout", "gym", "trap", "phonk", "beast", "power", "hard", "rage", "hip hop", "rap", "drill"] },
  { id: "focus", words: ["focus", "study", "instrumental", "piano", "classical", "ambient", "sleep", "meditation", "loops", "concentration"] },
  { id: "retro", words: ["retro", "90s", "80s", "70s", "old", "evergreen", "disco", "vinyl", "synthwave", "purane", "kishore", "lata"] },
  { id: "chill", words: ["chill", "acoustic", "indie", "soft", "mellow", "coffee", "jazz", "unplugged", "sufi", "ghazal", "arijit"] },
];

/** Best-guess mood for a track (title + artist + album), falling back to "luxe". */
export function inferMood(text: string): MoodId {
  const hay = (text || "").toLowerCase();
  if (!hay.trim()) return timeOfDayMood();
  for (const group of MOOD_KEYWORDS) {
    if (group.words.some((w) => hay.includes(w))) return group.id;
  }
  return "luxe";
}

/** Mood used before anything is playing — follows the clock. */
export function timeOfDayMood(): MoodId {
  const h = new Date().getHours();
  if (h < 5) return "sad";
  if (h < 11) return "chill";
  if (h < 16) return "focus";
  if (h < 20) return "luxe";
  return "party";
}

export function moodFor(id: string | null | undefined): Mood {
  if (id && id in MOODS) return MOODS[id as MoodId];
  return MOODS[timeOfDayMood()];
}

/** CSS for one mood layer — two soft colour blooms + a vignette. */
export function moodLayerStyle(mood: Mood, strength = 1): React.CSSProperties {
  const [a, b, c] = mood.colors;
  return {
    background: [
      `radial-gradient(58% 48% at 12% 8%, ${a}${Math.round(46 * strength).toString(16).padStart(2, "0")}, transparent 70%)`,
      `radial-gradient(52% 46% at 88% 16%, ${b}${Math.round(34 * strength).toString(16).padStart(2, "0")}, transparent 72%)`,
      `radial-gradient(70% 60% at 50% 108%, ${c}${Math.round(44 * strength).toString(16).padStart(2, "0")}, transparent 74%)`,
    ].join(", "),
    mixBlendMode: "screen",
  };
}
