/* Service worker browser.gowithdme.com.
   Hanya menyimpan berkas situs ini (cangkang aplikasi) agar bisa dibuka cepat dan tetap tampil saat offline.
   TIDAK menyentuh permintaan ke domain lain: proxy (workers.dev), Supabase, dan situs yang dibuka tidak lewat sini.
   Strategi: jaringan dulu, cadangan dari cache. Jadi hasil deploy baru langsung terlihat. */
var CACHE = "gwd-browser-v1";
var SHELL = [
  "./", "index.html", "legal.html",
  "css/style.css", "css/browser.css", "css/legal.css",
  "js/config.js", "js/track.js", "js/moderasi.js", "js/browser.js", "js/pwa.js", "js/legal.js",
  "assets/favicon.svg", "assets/icon-192.png", "assets/icon-512.png", "manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* satu per satu: gagal di satu berkas tidak membatalkan pemasangan */
      return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  if (u.origin !== self.location.origin) return;       /* domain lain: biarkan browser menangani */
  e.respondWith(
    fetch(r).then(function (res) {
      if (res && res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(r, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(r, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (r.mode === "navigate") return caches.match("index.html");
        return Response.error();
      });
    })
  );
});
