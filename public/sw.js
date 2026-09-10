/* Sidify Service Worker — app-shell PWA.
 * Network-first for navigations, cache-first for static assets.
 * Live search/stream API responses are never cached. */

const SHELL_CACHE = "sidify-shell-v1";
const STATIC_CACHE = "sidify-static-v1";

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
