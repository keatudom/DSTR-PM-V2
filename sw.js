// DSTR Service Worker — network-first (กันแคชค้าง) + offline shell
// แคชเฉพาะไฟล์ same-origin (HTML/CSS/JS) — ไม่แตะ API (script.google.com)
var CACHE = 'dstr-v2';
var SHELL = [
  'index.html', 'dashboard.html', 'checkin.html', 'daily.html',
  'css/main.css',
  'js/config.js', 'js/auth.js', 'js/api.js', 'js/state.js', 'js/modal.js',
  'manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // ปล่อย API/Google ผ่านปกติ (อย่าแคช)
  // network-first: ออนไลน์ = ได้ของใหม่เสมอ · ออฟไลน์ = ใช้ที่แคชไว้
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
