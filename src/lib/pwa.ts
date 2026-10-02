"use client";

/**
 * PWA update plumbing.
 *
 * Sidify ships as an installed PWA, so a new deployment can sit live on the server while the
 * browser keeps running the previous app shell — which makes a release look like it "never
 * arrived". This module gives the app a real, measurable update path:
 *
 *  · `registerServiceWorker()` — registers `/sw.js` with `updateViaCache: "none"` (the file
 *    itself is never taken from the HTTP cache), re-checks when the tab regains focus, and
 *    refreshes the page exactly once when a new worker takes control.
 *  · `checkForUpdate()` — the real implementation behind Settings → About → "Check now".
 *
 * Everything is a no-op where service workers are unavailable (Safari private mode, etc.).
 */

/** Session guard so a controller swap can never become a reload loop. */
const RELOAD_FLAG = "sidify-sw-reload";
/** Never ping `/sw.js` more often than this. */
const MIN_UPDATE_GAP_MS = 60_000;

export function serviceWorkersAvailable(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** Reload only if this tab has not already reloaded for an update. */
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") return false;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    /* private mode — fall through and reload anyway */
  }
  window.location.reload();
  return true;
}

/** Called shortly after a page load so a *later* update in the same tab can reload again. */
export function armNextAutoReload(delayMs = 10_000): () => void {
  const t = window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* ignore */
    }
  }, delayMs);
  return () => window.clearTimeout(t);
}

/** Registers the service worker and wires up silent update checks. Returns a cleanup fn. */
export function registerServiceWorker(): () => void {
  if (!serviceWorkersAvailable()) return () => {};

  // A worker only controls the page *before* this load when the app was already visited.
  const hadController = !!navigator.serviceWorker.controller;
  const cleanups: Array<() => void> = [];
  let swapped = false;
  let lastCheck = 0;

  const onControllerChange = () => {
    // The first-ever install also fires this; only replacing an existing worker is an update.
    if (!hadController || swapped) return;
    swapped = true;
    reloadOnce();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  cleanups.push(() => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange));

  const refresh = (reg: ServiceWorkerRegistration, force = false) => {
    const now = Date.now();
    if (!force && now - lastCheck < MIN_UPDATE_GAP_MS) return;
    lastCheck = now;
    reg.update().catch(() => {});
  };

  navigator.serviceWorker
    .register("/sw.js", { updateViaCache: "none", scope: "/" })
    .then((reg) => {
      refresh(reg, true);
      const onVisible = () => {
        if (document.visibilityState === "visible") refresh(reg);
      };
      document.addEventListener("visibilitychange", onVisible);
      const interval = window.setInterval(() => refresh(reg), 30 * 60 * 1000);
      cleanups.push(() => {
        document.removeEventListener("visibilitychange", onVisible);
        window.clearInterval(interval);
      });
    })
    .catch(() => {});

  return () => cleanups.forEach((fn) => fn());
}

export type UpdateResult = "updated" | "current" | "unsupported";

/**
 * Real "Check for updates": asks the browser to re-fetch `/sw.js` and reports whether a newer
 * build exists. When one does, the waiting worker is told to activate and the page reloads
 * onto the fresh shell.
 */
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!serviceWorkersAvailable()) return "unsupported";

  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!reg) return "unsupported";

  await reg.update().catch(() => {});

  const hadController = !!navigator.serviceWorker.controller;
  const isUpdating = () => !!reg.waiting || (hadController && !!reg.installing);

  // Give the browser a moment to install a byte-different worker.
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !isUpdating()) {
    await new Promise((r) => window.setTimeout(r, 250));
  }
  if (!isUpdating()) return "current";

  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  // Belt and braces: if the swap lands quietly, refresh anyway.
  window.setTimeout(() => window.location.reload(), 1800);
  return "updated";
}
