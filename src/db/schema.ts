import { pgTable, text, bigint, jsonb, integer, serial, timestamp } from "drizzle-orm/pg-core";

/** Stores the full track payload (title, artist, artwork, preview url, ...) as JSONB */
export const likedSongs = pgTable("liked_songs", {
  trackId: text("track_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  likedAt: timestamp("liked_at", { mode: "date" }).notNull().defaultNow(),
});

export const recentlyPlayed = pgTable("recently_played", {
  trackId: text("track_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  playedAt: timestamp("played_at", { mode: "date" }).notNull().defaultNow(),
});

export const downloads = pgTable("downloads", {
  trackId: text("track_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  quality: text("quality").notNull().default("high"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  downloadedAt: timestamp("downloaded_at", { mode: "date" }).notNull().defaultNow(),
});

export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const playlistTracks = pgTable("playlist_tracks", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull(),
  trackId: text("track_id").notNull(),
  payload: jsonb("payload").notNull(),
  position: integer("position").notNull().default(0),
  addedAt: timestamp("added_at", { mode: "date" }).notNull().defaultNow(),
});

export const followedArtists = pgTable("followed_artists", {
  artistId: text("artist_id").primaryKey(),
  payload: jsonb("payload").notNull(),
  followedAt: timestamp("followed_at", { mode: "date" }).notNull().defaultNow(),
});

export const blockedArtists = pgTable("blocked_artists", {
  artistId: text("artist_id").primaryKey(),
  name: text("name").notNull(),
  blockedAt: timestamp("blocked_at", { mode: "date" }).notNull().defaultNow(),
});
