const CACHE = 'tirecalc-shared-v4';

const FILES = [
'./',
'./index.html',
'./manifest.webmanifest',
'./icon-192.png',
'./icon-512.png'
];

self.addEventListener('install', event => {
event.waitUntil(
caches.open(CACHE)
.then(cache => cache.addAll(FILES))
.then(() => self.skipWaiting())
);
});

self.addEventListener('activate', event => {
event.waitUntil(
self.clients.claim()
);
});

self.addEventListener('fetch', event => {
const request = event.request;

if (request.method !== 'GET') return;

const url = new URL(request.url);

if (url.origin !== self.location.origin) return;

event.respondWith(
caches.match(request).then(cached => {
if (cached) return cached;

  return fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => {
        cache.put(request, copy);
      });
    }

    return response;
  }).catch(() => {
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }

return Response.error();
});
});
