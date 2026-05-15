/* AJKMart Rider App — SW v3 (2G/EDGE + old Android optimised)
   Strategy:
     Static assets (JS/CSS/SVG/images/fonts) → Cache-first
     HTML navigation                          → Stale-while-revalidate
     API calls (/api/*)                       → Network-first (10 s timeout) + cache fallback
     Google Fonts                             → Cache-first (immutable)
     Offline navigation                       → /rider/offline.html
     Push notifications                       → preserved
*/

var STATIC_CACHE = 'ajkm-rider-static-v3';
var API_CACHE    = 'ajkm-rider-api-v3';
var FONT_CACHE   = 'ajkm-rider-fonts-v3';
var ALL_CACHES   = [STATIC_CACHE, API_CACHE, FONT_CACHE];
var OFFLINE_URL  = '/rider/offline.html';

var PRECACHE = [
  '/rider/',
  '/rider/index.html',
  '/rider/offline.html',
  '/rider/manifest.json',
  '/rider/favicon.svg',
];

/* ── Install: precache critical app shell ────────────────────────────────── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) { return cache.addAll(PRECACHE); })
      .catch(function() { /* offline during install — ok, skip */ })
      .then(function() { return self.skipWaiting(); })
  );
});

/* ── Activate: remove ALL old cache versions ─────────────────────────────── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return ALL_CACHES.indexOf(k) === -1; })
          .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* ── Fetch router ────────────────────────────────────────────────────────── */
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch(_) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  var path = url.pathname;
  var host = url.hostname;

  /* Google / gstatic fonts — cache-first (immutable after first download) */
  if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  /* API calls — network-first, 10 s timeout on slow networks */
  if (path.indexOf('/api/') !== -1) {
    e.respondWith(networkFirst(req, API_CACHE, 10000));
    return;
  }

  /* Static assets (JS, CSS, images, fonts, icons) — cache-first */
  var ext = path.split('.').pop().toLowerCase();
  if ('js,css,svg,png,jpg,jpeg,webp,woff,woff2,ttf,eot,ico'.indexOf(ext) !== -1) {
    e.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  /* HTML page navigation — stale-while-revalidate so page opens instantly */
  if (req.mode === 'navigate') {
    e.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  /* Fallback — network first */
  e.respondWith(networkFirst(req, STATIC_CACHE, 15000));
});

/* ── Strategy helpers ────────────────────────────────────────────────────── */

function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(function() {
        return new Response('Resource unavailable offline', { status: 503 });
      });
    });
  });
}

function networkFirst(req, cacheName, timeoutMs) {
  return caches.open(cacheName).then(function(cache) {
    var didAbort = false;
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function() { didAbort = true; controller.abort(); }, timeoutMs)
      : null;

    var fetchOpts = controller ? { signal: controller.signal } : {};

    return fetch(req, fetchOpts)
      .then(function(res) {
        if (timer) clearTimeout(timer);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      })
      .catch(function() {
        if (timer) clearTimeout(timer);
        return cache.match(req).then(function(cached) {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches.match(OFFLINE_URL).then(function(p) {
              return p || new Response('Offline', { status: 503 });
            });
          }
          return new Response(
            JSON.stringify({ error: 'offline', offline: true, message: 'No internet connection' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        });
      });
  });
}

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(req).then(function(cached) {
      var networkFetch = fetch(req).then(function(res) {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(function() {
        if (!cached) {
          return caches.match(OFFLINE_URL).then(function(p) {
            return p || new Response('Offline', { status: 503 });
          });
        }
        return cached;
      });
      /* Return cached immediately if available; network fetch updates in background */
      return cached || networkFetch;
    });
  });
}

/* ── Push notifications ───────────────────────────────────────────────────── */
self.addEventListener('push', function(event) {
  var data = event.data ? event.data.json() : {};
  var title = data.title || 'AJKMart Rider';
  var options = {
    body: data.body || '',
    icon: '/rider/favicon.svg',
    badge: '/rider/favicon.svg',
    tag: data.tag || 'ajkmart-rider',
    data: data.data || {},
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var rideId = event.notification.data && event.notification.data.rideId;
  var url = rideId ? '/rider/active/' + rideId : '/rider/';
  event.waitUntil(clients.openWindow(url));
});

/* ── SW message relay (from app shell) ───────────────────────────────────── */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
