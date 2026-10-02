import type { Track } from "./types";

/** A listener's strongest artists, ranked by the number of distinct tracks played. */
export interface ListeningArtist {
  id: string;
  name: string;
  artwork?: string;
  genre?: string;
  tracksPlayed: number;
  /** Position of this artist's most recent track in the newest-first history. */
  recentRank: number;
}

const GENERIC_ARTISTS = new Set(["", "unknown", "unknown artist", "various artists", "youtube"]);

/** Remove common upload/channel suffixes and guest credits from an artist label. */
export function primaryArtistName(value: string): string {
  return (value || "")
    .replace(/\s*[-|–—]\s*(?:topic|vevo|official(?: channel| audio)?|music)$/i, "")
    .replace(/\s*\((?:official(?: music video| audio)?|lyrics video)\)$/i, "")
    .split(/\s+(?:feat(?:uring)?\.?|ft\.?|with)\s+/i, 1)[0]
    .split(/\s*[,/&]\s*/, 1)[0]
    .trim();
}

function artistKey(value: string): string {
  return primaryArtistName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Derive the artist shelf from this browser's listening history. History is newest first;
 * repeated tracks are counted once, so an artist rises by the variety of their tracks
 * rather than by an accidental duplicate payload.
 */
export function rankListeningArtists(history: Track[]): ListeningArtist[] {
  const artists = new Map<string, ListeningArtist>();
  const seenTracks = new Set<string>();

  history.forEach((track, recentRank) => {
    if (!track?.id || seenTracks.has(track.id)) return;
    seenTracks.add(track.id);

    const name = primaryArtistName(track.artist || "");
    const normalized = artistKey(name);
    if (GENERIC_ARTISTS.has(normalized) || normalized.length < 2) return;

    const id = typeof track.artistId === "string" ? track.artistId.trim() : "";
    const key = id ? `id:${id}` : `name:${normalized}`;
    const existing = artists.get(key);
    if (existing) {
      existing.tracksPlayed += 1;
      existing.recentRank = Math.min(existing.recentRank, recentRank);
      if (!existing.artwork && track.artwork) existing.artwork = track.artwork;
      if (!existing.genre && track.genre) existing.genre = track.genre;
      return;
    }

    artists.set(key, {
      id,
      name,
      artwork: track.artwork || undefined,
      genre: track.genre,
      tracksPlayed: 1,
      recentRank,
    });
  });

  return [...artists.values()].sort(
    (a, b) => b.tracksPlayed - a.tracksPlayed || a.recentRank - b.recentRank || a.name.localeCompare(b.name)
  );
}

/** Only accept search results that actually belong to the listened-to artist. */
export function matchesListeningArtist(track: Track, artist: ListeningArtist): boolean {
  if (!track?.artist) return false;
  if (artist.id && track.artistId && artist.id === track.artistId) return true;

  const wanted = artistKey(artist.name);
  if (wanted.length < 2) return false;

  // Search results sometimes list a feature artist after a comma, ampersand, or slash.
  const candidates = (track.artist || "")
    .split(/\s*(?:,|&|\/)\s*/)
    .map((name) => artistKey(name))
    .filter(Boolean);

  return candidates.some(
    (candidate) =>
      candidate === wanted ||
      candidate.startsWith(`${wanted} `) ||
      candidate.endsWith(` ${wanted}`) ||
      candidate.includes(` ${wanted} `)
  );
}

/**
 * Filter out already-played songs and unrelated search hits, dedupe, then interleave
 * each preferred artist's results so one artist cannot drown out the rest of the taste mix.
 */
export function curateListeningRecommendations(
  history: Track[],
  artists: ListeningArtist[],
  candidatesByArtist: Track[][],
  limit = 14
): Track[] {
  const playedIds = new Set(history.map((track) => track?.id).filter(Boolean));
  const queues = artists.map((artist, index) =>
    (candidatesByArtist[index] ?? []).filter(
      (track) => track?.id && !playedIds.has(track.id) && matchesListeningArtist(track, artist)
    )
  );
  const seen = new Set<string>(playedIds);
  const recommendations: Track[] = [];
  const cursors = queues.map(() => 0);

  while (recommendations.length < limit) {
    let added = false;

    for (let i = 0; i < queues.length && recommendations.length < limit; i += 1) {
      const queue = queues[i];
      while (cursors[i] < queue.length && seen.has(queue[cursors[i]].id)) cursors[i] += 1;
      const track = queue[cursors[i]];
      if (!track) continue;

      cursors[i] += 1;
      seen.add(track.id);
      recommendations.push(track);
      added = true;
    }

    if (!added) break;
  }

  return recommendations;
}
