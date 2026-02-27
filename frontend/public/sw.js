const CACHE_NAME = "mercosur-news-v2";
const PRECACHE_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  // Activate new SW as soon as it's installed
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));

      // Take control immediately
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Navigation requests: try network, fall back to cached "/" if offline
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cached = await caches.match("/");
          return cached || new Response("Offline", { status: 200, headers: { "Content-Type": "text/plain" } });
        }
      })()
    );
    return;
  }

  // Everything else: cache-first for precached items, otherwise network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});