// Service Worker: Cache-first für App-Shell und Profile, damit alles offline läuft.
// CACHE_VERSION wird von `npm run build` aus dem Inhalt aller Dateien berechnet –
// nicht von Hand ändern.
const CACHE_VERSION = '2a82b5d2ff';
const CACHE_NAME = `darkroomtimer-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/alerts.js',
  './js/format.js',
  './js/profile.js',
  './js/runner.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './profiles/index.json',
];

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  // Profile dynamisch aus dem Index – neue Dateien brauchen keine Änderung hier.
  const index = await (await cache.match('./profiles/index.json')).json();
  await cache.addAll(index.profiles.map((file) => `./profiles/${file}`));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('darkroomtimer-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
