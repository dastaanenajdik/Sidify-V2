"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * False during the server render and hydration, true afterwards — for reading
 * browser-only state (localStorage, window) without a setState-in-effect.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}
