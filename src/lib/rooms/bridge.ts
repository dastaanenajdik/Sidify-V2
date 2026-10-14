"use client";

import type { Track } from "@/lib/types";

/**
 * The seam between the audio engine and a Listen Together room.
 *
 * While a room is joined, every *intent* the listener expresses through the
 * engine's public functions (play this list, pause, skip, seek, queue edits, a
 * track running out) is handed to the room instead of acted on locally; the
 * room client applies the room's answer back through the engine's local
 * functions. Kept in its own module so the engine never imports the client.
 */
export interface RoomBridge {
  active(): boolean;
  playContext(tracks: Track[], start: number, label: string): void;
  setPlaying(play: boolean): void;
  next(): void;
  prev(): void;
  seek(ms: number): void;
  jump(index: number): void;
  queueAdd(track: Track, mode: "next" | "end"): void;
  queueRemove(index: number): void;
  queueMove(from: number, to: number): void;
  queueClear(): void;
  setAutoplay(on: boolean): void;
  ended(track: Track): void;
  /** The sleep timer fired: step out of the room rather than pause everyone. */
  sleep(): void;
}

let bridge: RoomBridge | null = null;

export function setRoomBridge(b: RoomBridge | null) {
  bridge = b;
}

/** The bridge, only while a room is actually live. */
export function roomBridge(): RoomBridge | null {
  return bridge && bridge.active() ? bridge : null;
}
