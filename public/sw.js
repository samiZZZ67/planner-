const CACHE_NAME = 'night-planner-v1.2.0';

const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/icons/icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/fonts/Demon Slave.ttf',
  '/fonts/BloodyHell.woff2',
];

// Install event: Pre-cache app shell and fonts
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Pre-cache critical core assets
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (e) {
          // If font files aren't uploaded yet by user, continue gracefully
          console.warn(`Pre-cache notice for ${asset}:`, e.message);
        }
      }
    })
  );
  // Do not automatically skip waiting so client can detect new version
});

// Activate event: clean up stale caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Network-first for navigation with offline fallback; Cache-first for static assets
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension/external requests
  if (request.method !== 'GET' || !url.origin.includes(self.location.origin)) {
    return;
  }

  // Never cache API routes
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: HTML document
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          // Offline navigation fallback: serve cached root app shell
          const cached = await caches.match('/') || await caches.match(request);
          if (cached) return cached;
          return new Response("<h1>Offline</h1><p>Sam'Space offline cache is ready.</p>", {
            headers: { 'Content-Type': 'text/html' },
          });
        })
    );
    return;
  }

  // Static assets: JS, CSS, Fonts, Images
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

// Handle update reload message from client
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
