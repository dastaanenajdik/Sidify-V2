export interface Track {
  id: string;
  videoId?: string; // YouTube video id (primary playback key)
  title: string;
  artist: string;
  artistId?: string; // YouTube channel id
  album?: string;
  albumId?: string;
  artwork: string; // YouTube thumbnail url (maxres preferred, client falls back)
  previewUrl: string; // legacy field, kept for stored-library compatibility
  durationMs: number;
  genre?: string;
  releaseDate?: string;
  explicit?: boolean;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  artwork: string;
  releaseDate?: string;
  trackCount?: number;
  genre?: string;
}

export interface Artist {
  id: string;
  name: string;
  genre?: string;
  artwork?: string;
}

export interface PlaylistRow {
  id: number;
  name: string;
  createdAt: string;
  tracks: Track[];
}

export interface DownloadRow {
  trackId: string;
  track: Track;
  quality: string;
  sizeBytes: number;
  downloadedAt: string;
}

export interface FollowedArtistRow {
  artistId: string;
  artist: Artist;
  followedAt: string;
}

export interface HomeData {
  trending: Track[];
  newReleases: Album[];
  topArtists: Artist[];
  recommended: Track[];
  recentlyPlayed: Track[];
  basedOnArtist?: string;
}
