/* ==========================================================================
   BASE FORGE — SAFE PROGRESSIVE WEB APP SERVICE WORKER
   Isolates App Shell caching from Supabase Auth, DB, and Storage.
   ========================================================================== */

const CACHE_VERSION = 'baseforge-v1.0.0';
const SHELL_CACHE = `baseforge-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `baseforge-static-${CACHE_VERSION}`;

// Pre-cached assets for the offline app shell
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://res.cloudinary.com/prjgzqvy/image/upload/c_fill,w_192,h_192/v1788604860/grok_1788604728310_kefg92.jpg'
];

// Install: Cache core shell and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[BaseForge PWA] Non-fatal precache error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Prune stale/legacy caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== SHELL_CACHE && key !== STATIC_CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Safe routing and strict bypass of Supabase / dynamic data
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. NEVER intercept non-GET requests (mutations, uploads, sign-in)
  if (request.method !== 'GET') {
    return;
  }

  // 2. CRITICAL SECURITY: Never cache Supabase API, Auth, REST, or Storage
  if (url.hostname.includes('supabase.co')) {
    return; // Passthrough directly to network
  }

  // 3. For navigation (HTML document requests): Network-First with cache fallback
  // This ensures code updates and index.html deployments reflect immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('./index.html');
          return fallback || new Response('Offline - Base Forge shell unavailable', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // 4. Static Fonts & CDNs: Cache-First with background revalidation
  if (url.origin === 'https://fonts.googleapis.com' || 
      url.origin === 'https://fonts.gstatic.com' ||
      url.origin === 'https://cdn.jsdelivr.net') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 5. Cloudinary & Static Images: Stale-While-Revalidate (only GET)
  if (url.origin.includes('cloudinary.com') || request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return networkResponse;
        }).catch(() => null);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Default: Network fetch with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
