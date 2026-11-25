/* PWA: daftar service worker + tombol "Pasang sebagai aplikasi".
   Dipakai browser.js lewat window.GWD_PWA. Aman bila service worker tidak didukung. */
(function (w) {
  "use strict";
  var deferred = null;
  var standalone = false;
  try { standalone = (w.matchMedia && w.matchMedia("(display-mode: standalone)").matches) || w.navigator.standalone === true; } catch (e) {}

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    w.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  w.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferred = e; });
  w.addEventListener("appinstalled", function () { deferred = null; standalone = true; });

  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");

  w.GWD_PWA = {
    standalone: function () { return standalone; },
    /* "prompt" = bisa dipasang langsung, "ios" = harus lewat menu Bagikan Safari, "" = tidak tersedia/sudah terpasang */
    kind: function () { if (standalone) return ""; if (deferred) return "prompt"; if (ios) return "ios"; return ""; },
    install: function () {
      if (!deferred) return Promise.resolve("none");
      var d = deferred; deferred = null;
      d.prompt();
      return d.userChoice.then(function (c) { return c && c.outcome; }).catch(function () { return "none"; });
    }
  };
})(window);
