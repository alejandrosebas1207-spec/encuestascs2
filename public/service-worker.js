/* Modo de contingencia Clima Social: conserva aplicación base y cartografía.
 * No almacena respuestas de Kobo ni coordenadas de encuestas en el teléfono. */
const CACHE_NAME = 'clima-social-v100-carchi-fix';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css?v=85.0.0',
  '/script.js?v=85.0.0',
  '/libs/maplibre-gl.js',
  '/libs/maplibre-gl.css',
  '/assets/icono.png',
  '/assets/01_ClimaSocial_Horizontal_Transparente.png',
  '/assets/01_Logo_Clima_Social_Horizontal_Oficial.svg'
];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[SW] Purgando caché obsoleta o heredada:', key);
          return caches.delete(key);
        }
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // 1. Navegación HTML: Network-first estricto, fallback EXCLUSIVO al shell de Quito v17
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match('/index.html')))
    );
    return;
  }

  // 2. Cartografía y código (.geojson, .js, .css): Network-First
  if (url.pathname.endsWith('.geojson') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match(request)))
    );
    return;
  }

  // 3. Assets estáticos (imágenes, fuentes, librerías): Cache-first dentro de CACHE_NAME
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/libs/') || url.pathname.startsWith('/fonts/'))) {
            const copy = response.clone();
            cache.put(request, copy);
          }
          return response;
        });
      });
    })
  );
});
