/* Sidify Service Worker — app-shell PWA.
 * Network-first for navigations, cache-first for static assets.
 * Live search/stream API responses are never cached. */

/* v3: bumped after the backdrop/z-index fix in 1.1.0. Any client still holding the old
 * app shell must drop it, so both cache names move forward and activate() deletes the
 * previous ones. Installed PWAs pick this up at most one reload after the deploy thanks to
 * `src/lib/pwa.ts` (updateViaCache: none + controllerchange reload). */
const SHELL_CACHE = "sidify-shell-v5";
const STATIC_CACHE = "sidify-static-v5";

const APP_SHELL = [
  "./",
  "/manifest.json",
  "/icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![SHELL_CACHE, STATIC_CACHE].includes(k)).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/* Explicit update request from the page (Settings → "Check now"): activate immediately
 * instead of waiting for every Sidify tab to be closed. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:png|jpg|jpeg|svg|webp|woff2?|ttf|otf|css|js)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache live API traffic (search, stream, library).
  if (isApi(url)) return;

  // Never cache YouTube thumbnails/media or cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match("/")) || Response.error();
        })
    );
    return;
  }

  // Static assets: cache-first with background fill.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request)
            .then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
              }
              return res;
            })
            .catch(() => hit || Response.error())
      )
    );
    return;
  }
});
