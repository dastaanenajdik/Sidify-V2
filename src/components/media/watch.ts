import type { MediaReleaseItem } from "@/lib/media/types";

/**
 * One thing the user can play or download: a movie, an episode, or a season's packs.
 * Its `releases` are every quality/encode of that one item.
 */
export interface WatchTarget {
  /**
   * Stable and unique per item across titles — `movie-<slug>`, `<slug>-s2e5`,
   * `<slug>-s2-packs`. Also the key of the saved "continue from" position.
   */
  key: string;
  /** Sheet heading, e.g. `Moana` or `S02E05 · Marvel's The Punisher`. */
  heading: string;
  /** Name handed to external players and playlist files. */
  mediaTitle: string;
  releases: MediaReleaseItem[];
  poster?: string;
}
