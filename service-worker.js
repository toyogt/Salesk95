// /salesk95/service-worker.js
const CACHE_NAME = 'k95-sales-v20';
const urlsToCache = [
  '/salesk95/',
  '/salesk95/index.html',
  '/salesk95/manifest.json',
  '/salesk95/icons/android-chrome-192x192.png',
  '/salesk95/icons/android-chrome-512x512.png',
  '/salesk95/icons/apple-touch-icon.png',
  '/salesk95/icons/favicon-16x16.png',
  '/salesk95/icons/favicon-32x32.png',
  '/salesk95/icons/favicon-48x48.png',
  '/salesk95/lib/supabase.js',
];

// Install: cache static assets
self.addEventListener('install', event => {
  self.skipWaiting();
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache opened, adding URLs');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('Cache install error:', err))
  );
});

// Fetch: network‑first for dynamic resources, cache‑first for static assets
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const request = event.request;

  // Authentication and database responses must always come from the network
  // and must never be stored in a shared service-worker cache.
  if (url.includes('/proxy.php') || url.includes('/auth/v1/') || url.includes('/rest/v1/') || url.includes('/storage/v1/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Helper: determine if this is an HTML navigation request
  const isHTML = request.headers.get('accept')?.includes('text/html') || url.endsWith('.html');

  // --- 1. Always try network first for HTML pages and external CDN resources ---
  if (isHTML ||
      url.includes('cdn.jsdelivr.net') ||
      url.includes('cdnjs.cloudflare.com') ||
      url.includes('fonts.googleapis.com') ||
      url.includes('fonts.gstatic.com')) {

    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // Only cache successful responses
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, responseToCache))
              .catch(err => console.log('Cache put error:', err));
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails, fallback to cache (if available)
          return caches.match(request).then(cached => {
            if (cached) return cached;
            // No cache and offline – return a minimal offline page for HTML
            if (isHTML) {
              return new Response(
                '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline. Please check your connection.</h1></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              );
            }
            // For other resources, just fail
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
        })
    );
    return;
  }

  // --- 2. For all other requests (your own origin assets), use cache-first ---
  event.respondWith(
    caches.match(request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // Not in cache – fetch and cache for next time
        return fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, responseToCache))
              .catch(err => console.log('Cache put error:', err));
          }
          return networkResponse;
        });
      })
      .catch(() => {
        // If both cache and network fail, return a generic error
        return new Response('Resource unavailable', { status: 503 });
      })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker activating');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});
