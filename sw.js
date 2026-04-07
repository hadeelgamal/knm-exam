// KNM Exam — Service Worker
// Caches all app files for offline use.

const CACHE = 'knm-v1';
const ASSETS = [
  './',
  './index.html',
  './exam_data.js',
  './translations.js',
  './explanations.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // Google Fonts — cached on first use
];

// Install: cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for app files, network-first for fonts
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for Google Fonts (best effort, fall back to cache)
  if (url.hostname.includes('fonts.g')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for everything else (app shell + data files)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
    })
  );
});
