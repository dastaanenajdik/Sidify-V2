/** Moods and genres for Explore — each one is a search seed with its own colour. */

export interface Mood {
  slug: string;
  title: string;
  color: string;
  /** What we ask the catalogue for. */
  q: string;
  kind: "mood" | "genre";
  /** Optional static artwork for the tile (a /public path). Skips the cover lookup. */
  art?: string;
}

export const MOODS: Mood[] = [
  { slug: "chill", title: "Chill", color: "#7aaed0", q: "chill songs", kind: "mood" },
  { slug: "feel-good", title: "Feel Good", color: "#86b890", q: "feel good songs", kind: "mood" },
  { slug: "energize", title: "Energize", color: "#d0a060", q: "energetic songs", kind: "mood" },
  { slug: "workout", title: "Workout", color: "#cc6a55", q: "workout music", kind: "mood" },
  { slug: "focus", title: "Focus", color: "#8090c8", q: "focus music for studying", kind: "mood" },
  { slug: "romance", title: "Romance", color: "#c07a92", q: "romantic songs", kind: "mood" },
  { slug: "sad", title: "Sad", color: "#6a88b0", q: "sad songs", kind: "mood" },
  { slug: "party", title: "Party", color: "#9c8ac0", q: "party songs", kind: "mood" },
  { slug: "sleep", title: "Sleep", color: "#5a6e9a", q: "calm sleep music", kind: "mood" },
  { slug: "commute", title: "Commute", color: "#b0886a", q: "road trip songs", kind: "mood" },
  { slug: "bollywood", title: "Bollywood", color: "#d08a4a", q: "bollywood hits", kind: "genre" },
  { slug: "punjabi", title: "Punjabi", color: "#9ab060", q: "punjabi hits", kind: "genre" },
  { slug: "hip-hop", title: "Hip-Hop", color: "#8a8aa0", q: "hip hop hits", kind: "genre" },
  { slug: "pop", title: "Pop", color: "#d07aa8", q: "pop hits", kind: "genre" },
  { slug: "indie", title: "Indie", color: "#70a89a", q: "indie pop songs", kind: "genre" },
  { slug: "rock", title: "Rock", color: "#b05a5a", q: "rock anthems", kind: "genre" },
  { slug: "dance", title: "Dance & Electronic", color: "#5aa0c8", q: "edm dance hits", kind: "genre" },
  { slug: "k-pop", title: "K-Pop", color: "#b88ad0", q: "kpop hits", kind: "genre" },
  { slug: "lofi", title: "Lo-Fi", color: "#8a9a7a", q: "lofi beats", kind: "genre" },
  { slug: "phonk-funk", title: "Phonk & Funk", color: "#a85a9a", q: "phonk funk", kind: "genre", art: "/covers/phonk-funk.jpg" },
  { slug: "bgm", title: "BGM", color: "#6a9ab0", q: "background music", kind: "genre" },
  { slug: "jazz", title: "Jazz", color: "#c0a060", q: "jazz classics", kind: "genre" },
  { slug: "classical", title: "Classical", color: "#a09080", q: "classical music", kind: "genre" },
  { slug: "90s", title: "90s Throwback", color: "#c08aa0", q: "90s hits", kind: "genre" },
  { slug: "devotional", title: "Devotional", color: "#d0b070", q: "devotional songs", kind: "genre" },
  { slug: "ghazal", title: "Ghazals & Sufi", color: "#9a7a8a", q: "ghazal sufi songs", kind: "genre" },
];

export function moodBySlug(slug: string): Mood | undefined {
  return MOODS.find((m) => m.slug === slug);
}
