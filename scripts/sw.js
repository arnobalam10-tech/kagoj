/* Kagoj service worker (generated into dist/sw.js by scripts/build.js). */
/* eslint-disable */
var VERSION = 'kagoj-__VERSION__';
var PRECACHE = __PRECACHE__;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }           // Supabase etc. go straight to the network
  if (url.pathname.indexOf('/api/') === 0) { return; }
  // hashed bundles, vendor libraries, icons, fonts: cache first
  if (/^\/(assets|vendor|icons|fonts)\//.test(url.pathname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
        return res;
      });
    }));
    return;
  }
  // the app shell: network first, cached copy when offline
  if (req.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('/', copy); }); }
      return res;
    }).catch(function () { return caches.match('/'); }));
  }
});
