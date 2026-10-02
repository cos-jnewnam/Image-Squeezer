// Bump VERSION when you publish a change so installed copies pick it up.
const VERSION = 'v1';
const CACHE = 'image-squeezer-' + VERSION;

const PRECACHE = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/zip.js',
  'js/crc32.js',
  'js/worker.js',
  'wasm/mozjpeg_enc.wasm',
  'wasm/squoosh_oxipng_bg.wasm',
  'wasm/imagequant_bg.wasm',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

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
      return (await network) || new Response('Offline', { status: 503 });
    })
  );
});
