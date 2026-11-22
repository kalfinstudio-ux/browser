/* Pencatat lalu lintas browser.gowithdme.com -> Supabase (RPC browser_log), tampil di Panel Admin > Statistik > Browser.
   Yang dikirim: jenis aksi, nama situs (host), path tanpa query/hash, mode, ukuran layar, waktu muat, kode acak per browser.
   TIDAK dikirim: IP, cookie, kata pencarian, isi halaman. Mati otomatis bila Do Not Track aktif atau gwm_notrack=1.
   Pemakaian:  GWD_TRACK.log("nav", { url: "https://contoh.com/a?x=1", mode: "proxy" }) */
(function (w) {
  var C = w.GWD_CONFIG || {};
  var BASE = String(C.SUPABASE_URL || "").replace(/\/+$/, ""), KEY = C.SUPABASE_ANON_KEY || "";
  var noop = { log: function () {}, on: false };

  function off() {
    try {
      if (navigator.doNotTrack === "1" || w.doNotTrack === "1" || (navigator.msDoNotTrack === "1")) return true;
      if (localStorage.getItem("gwm_notrack") === "1") return true;
    } catch (e) {}
    return false;
  }
  if (!BASE || !KEY || off()) { w.GWD_TRACK = noop; return; }

  function rnd() {
    try {
      var a = new Uint8Array(8); crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    } catch (e) { return Math.random().toString(16).slice(2, 10) + Date.now().toString(16); }
  }
  function store(area, k) {
    try { var v = w[area].getItem(k); if (!v) { v = rnd(); w[area].setItem(k, v); } return v; } catch (e) { return null; }
  }
  var VID = store("localStorage", "gwd.vid"), SID = store("sessionStorage", "gwd.sid") || rnd();

  function device() { var x = w.innerWidth || 0; return x < 600 ? "mobile" : x < 1024 ? "tablet" : "desktop"; }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ""; } }
  var LANG = String(navigator.language || "").slice(0, 2).toLowerCase();
  var REF = ""; try { REF = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
  if (REF === location.hostname) REF = "";

  var queue = [], timer = null, FAILS = 0, MAXQ = 100;

  function flush(final) {
    clearTimeout(timer); timer = null;
    if (!queue.length || FAILS >= 5) return;
    var batch = queue.splice(0, 25);
    try {
      fetch(BASE + "/rest/v1/rpc/browser_log", {
        method: "POST", keepalive: !!final,
        headers: { "Content-Type": "application/json", "apikey": KEY },
        body: JSON.stringify({ p_events: batch })
      }).then(function (r) {
        if (!r.ok) { FAILS++; } else { FAILS = 0; }
        if (queue.length && !final) schedule();
      }).catch(function () { FAILS++; });
    } catch (e) { FAILS++; }
    if (final && queue.length) flush(true);
  }
  function schedule() { if (!timer) timer = setTimeout(flush, 4000); }

  /* d.url (alamat penuh) diubah menjadi host + path saja. d.host / d.path juga boleh dipakai langsung. */
  function log(kind, d) {
    d = d || {};
    var host = d.host || "", path = d.path || "";
    if (d.url) {
      try { var u = new URL(d.url); host = u.hostname; path = u.pathname; } catch (e) {}
    }
    var ev = { src: "client", kind: kind, sid: SID, vid: VID, host: host, path: path, mode: d.mode || null,
      width: d.width != null ? d.width : (w.innerWidth || null), device: device(), lang: LANG };
    if (d.ms != null) ev.ms = Math.round(d.ms);
    if (d.status != null) ev.status = d.status;
    if (d.meta) ev.meta = d.meta;
    if (kind === "open") ev.ref_host = REF;
    queue.push(ev);
    if (queue.length > MAXQ) queue.shift();
    if (queue.length >= 10) flush(); else schedule();
  }

  /* Detak tiap 30 detik saat halaman terlihat -> dipakai untuk durasi kunjungan dan "aktif sekarang" */
  setInterval(function () { if (!document.hidden) log("heartbeat"); }, 30000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(true); });
  w.addEventListener("pagehide", function () { flush(true); });

  w.GWD_TRACK = { log: log, hostOf: hostOf, on: true };
})(window);
