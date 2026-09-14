"use client";

/**
 * Tiny cross-component refresh bus.
 *
 * Lives in its own module (rather than inside `library.tsx`) because the playback engine
 * needs to announce "this track was just played" too, and importing the hooks module from
 * the engine would close an import cycle.
 */
const listeners = new Set<(key: string) => void>();

export function emitRefresh(key: string) {
  listeners.forEach((f) => f(key));
}

export function onRefresh(f: (key: string) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
