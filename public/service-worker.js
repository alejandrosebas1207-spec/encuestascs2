/* Modo de contingencia: conserva solo la aplicación y cartografía pública.
 * No almacena respuestas de Kobo ni coordenadas de encuestas en el teléfono. */
const CACHE_NAME = 'clima-social-campo-v15';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/libs/maplibre-gl.js',
  '/libs/maplibre-gl.css',
  '/assets/icono.png',
  '/assets/01_ClimaSocial_Horizontal_Transparente.png',
  '/assets/parroquias.geojson',
  '/assets/sectores_censales.geojson'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/libs/'))) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
