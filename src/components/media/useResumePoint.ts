"use client";

import { useSyncExternalStore } from "react";
import { RESUME_EVENT, RESUME_STORAGE_KEY, loadResumePoint, resumePosition } from "@/lib/media/resumePoints";

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === RESUME_STORAGE_KEY) onChange();
  };
  window.addEventListener(RESUME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RESUME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Saved Try Play position for one item (seconds), or `null`. Server render and first
 * client render return `null`, so labels never cause a hydration mismatch.
 */
export function useResumePoint(key: string | null | undefined): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (key ? resumePosition(loadResumePoint(key)) : null),
    () => null
  );
}
