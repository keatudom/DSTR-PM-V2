// DSTR Service Worker — network-first (กันแคชค้าง) + offline shell
// แคชเฉพาะไฟล์ same-origin (HTML/CSS/JS) — ไม่แตะ API (script.google.com)
// ⚠️ เลข CACHE ต้องเปลี่ยนทุกครั้งที่ shell เปลี่ยนชุดไฟล์ — activate จะล้างถังเก่าทิ้งให้เอง
//    'dstr-v3' = หลังตัดยอดดีไซน์ใหม่ 2026-08-13 (design-system.css + shell.js + Lucide)
//    'dstr-v4' = แก้เมนู/มือถือ 2026-08-13 รอบบ่าย (shell.js + design-system.css เปลี่ยน)
var CACHE = 'dstr-v13';
var SHELL = [
  'index.html', 'dashboard.html', 'checkin.html', 'daily.html', 'content.html', 'tour.html',
  'css/design-system.css',
  // ไอคอนต้องแคช — ช่างใช้กลางไซต์ เน็ตหลุดแล้วไอคอนหายทั้งหน้า อ่านไม่ออกเลย
  'vendor/lucide/lucide.min.js',
  'vendor/pannellum/pannellum.css', 'vendor/pannellum/pannellum.js',
  'js/config.js', 'js/auth.js', 'js/api.js', 'js/state.js', 'js/modal.js',
  'js/shell.js', 'js/pwa-install.js', 'js/tour.js', 'js/pano-capture.js',
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
