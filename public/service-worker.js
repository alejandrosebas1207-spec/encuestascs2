/* Modo de contingencia: conserva solo la aplicación y cartografía pública.
 * No almacena respuestas de Kobo ni coordenadas de encuestas en el teléfono. */
const CACHE_NAME = 'clima-social-el-carmen-v8';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css?v=5.9.2',
  '/script.js?v=5.9.2',
  '/libs/maplibre-gl.js',
  '/libs/maplibre-gl.css',
  '/assets/icono.png',
  '/assets/01_ClimaSocial_Horizontal_Transparente.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => {
          console.log('[SW] Eliminando caché obsoleta:', key);
          return caches.delete(key);
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // 1. Navegación (HTML): Network First, fallback a caché
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. GeoJSON y scripts/estilos de aplicación: Network First (prioridad red para cambios de cantón inmediatos)
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
        .catch(() => caches.match(request))
    );
    return;
  }

  // 3. Recursos estáticos inmutables (fuentes, librerías fijas, imágenes): Cache First
  event.respondWith(
    caches.match(request).then(cached => {
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
