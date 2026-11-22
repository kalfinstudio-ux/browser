/* Moderasi di halaman browser (cek lunak) + tombol "Laporkan situs".
   Daftar blokir/peringatan diambil dari Supabase (RPC browser_blocklist_public) dan disimpan di sessionStorage 5 menit.
   Penegakan yang sebenarnya ada di Worker (hanya mode Proxy); di mode Langsung ini hanya pencegah di halaman ini.
   Laporan hanya mengirim: nama situs, path tanpa query, alasan, dan kode kunjungan acak (bila pencatatan aktif). */
(function (w) {
  var C = w.GWD_CONFIG || {};
  var BASE = String(C.SUPABASE_URL || "").replace(/\/+$/, ""), KEY = C.SUPABASE_ANON_KEY || "";
  var CK = "gwd.mod.rules", TTL = 5 * 60 * 1000, rules = null;

  function hostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch (e) { return ""; } }
  function index(rows) {
    var m = {};
    (rows || []).forEach(function (r) { if (r && r.host && (r.action === "block" || r.action === "warn")) m[String(r.host).toLowerCase()] = r.action; });
    return m;
  }
  function call(fn, body) {
    return fetch(BASE + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: { "Content-Type": "application/json", "apikey": KEY }, body: JSON.stringify(body || {})
    });
  }
  function load() {
    if (!BASE || !KEY) return;
    try {
      var c = JSON.parse(sessionStorage.getItem(CK));
      if (c && Date.now() - c.t < TTL && Array.isArray(c.r)) { rules = index(c.r); return; }
    } catch (e) {}
    call("browser_blocklist_public").then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
      if (!Array.isArray(rows)) return;
      rules = index(rows);
      try { sessionStorage.setItem(CK, JSON.stringify({ t: Date.now(), r: rows })); } catch (e) {}
    }).catch(function () {});
  }

  /* Hasil: { action: "block"|"warn", host: <host aturan> } atau null. "block" menang atas "warn". */
  function match(url) {
    if (!rules) return null;
    var p = hostOf(url).split("."), found = null;
    for (var i = 0; i <= p.length - 2; i++) {
      var h = p.slice(i).join("."), a = rules[h];
      if (a === "block") return { action: "block", host: h };
      if (a && !found) found = { action: "warn", host: h };
    }
    return found;
  }
  function isAcked(h) { try { return sessionStorage.getItem("gwd.ack." + h) === "1"; } catch (e) { return false; } }
  function ack(h) { try { sessionStorage.setItem("gwd.ack." + h, "1"); } catch (e) {} }

  function report(url, reason) {
    if (!BASE || !KEY) return Promise.resolve(false);
    var u; try { u = new URL(url); } catch (e) { return Promise.resolve(false); }
    var sid = null;
    try { if (w.GWD_TRACK && w.GWD_TRACK.on) sid = sessionStorage.getItem("gwd.sid"); } catch (e) {}
    return call("browser_report", { p_host: u.hostname, p_path: u.pathname, p_reason: reason, p_sid: sid })
      .then(function (r) { return r.ok ? r.json() : false; }).then(function (ok) { return ok === true; })
      .catch(function () { return false; });
  }

  w.GWD_MOD = { match: match, isAcked: isAcked, ack: ack, report: report };
  load();
})(window);
