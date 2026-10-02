// Generated into /sw.js by build.mjs. Edit this file, not the generated one.
// VERSION is a hash of the precached files, so it changes only when they do.
const VERSION = '__VERSION__';
const CACHE = 'image-squeezer-' + VERSION;

const OFFLINE_PAGE = 'offline.html';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from cache first and refresh the cached copy in the background.
// Files not listed above (the HEIC decoder, for one) are cached the first time they are used.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') {
        const offline = await cache.match(OFFLINE_PAGE);
        if (offline) return offline;
      }
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })
  );
});
