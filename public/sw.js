const CACHE_NAME = 'toursred-v1';
const STATIC_ASSET_REGEX = /\.(js|css|woff|woff2|png|jpg|jpeg|svg|ico|webp)$/i;

const PRECACHE_URLS = [
  '/apple-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/logo.svg',
  '/favicon.ico',
  '/site.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/functions/v1/')) {
    return;
  }

  if (request.mode === 'navigate') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (STATIC_ASSET_REGEX.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request)
            .then((resp) => {
              if (resp && resp.status === 200) {
                const clone = resp.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(request).then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return resp;
        });
      })
    );
    return;
  }
});
