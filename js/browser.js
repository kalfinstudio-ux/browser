/* Browser mini: tab, riwayat, bookmark, pencarian, ukuran layar.
   Mode "proxy" memuat situs lewat Worker (worker/proxy.js); mode "direct" memuat langsung. */
(function () {
  var C = window.GWD_CONFIG || {};
  var PROXY = (C.PROXY_URL || "").replace(/\/+$/, "");
  var PROXY_ORIGIN = "";
  try { PROXY_ORIGIN = PROXY ? new URL(PROXY).origin : ""; } catch (e) { PROXY = ""; }
  var SEARCH = C.SEARCH_URL || "https://html.duckduckgo.com/html/?q=";
  var HOME = C.DEFAULT_URL || "https://gowithdme.com";
  var MAX_TABS = 8;
  var T = window.GWD_TRACK || { log: function () {} };   /* js/track.js; aman bila tidak dimuat */

  var $ = function (id) { return document.getElementById(id); };
  var tabsEl = $("tabs"), form = $("form"), urlIn = $("url"), stage = $("stage"), empty = $("empty"),
      backB = $("back"), fwdB = $("fwd"), reloadB = $("reload"), homeB = $("home"), starB = $("star"),
      menuB = $("menuBtn"), menu = $("menu"), modeSel = $("mode"), sizeSel = $("size"), info = $("info"),
      loadBar = $("load"), themeBtn = $("themeBtn"), toast = $("toast"), exitFocus = $("exitFocus"), dial = $("dial"), notice = $("notice"), noticeText = $("noticeText"), tryProxy = $("tryProxy"), openTab = $("openTab");

  var tabs = [], active = null, nextId = 1, width = 0, noticeTimer = null, toastTimer = null;

  /* ---------- tema ---------- */
  var THEMES = ["auto", "light", "dark"], THEME_LABEL = { auto: "\u25d1 Otomatis", light: "\u2600 Terang", dark: "\u263e Gelap" };
  var theme = "auto", mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    var dark = theme === "dark" || (theme === "auto" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = $("themeColor"); if (m) m.setAttribute("content", dark ? "#161c19" : "#ffffff");
    themeBtn.textContent = THEME_LABEL[theme];
  }
  function setTheme(t) { theme = t; save("gwd.theme", t); applyTheme(); }
  if (mq && mq.addEventListener) mq.addEventListener("change", applyTheme);

  function flash(text, ms) {
    toast.textContent = text; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.hidden = true; }, ms || 2200);
  }

  /* ---------- penyimpanan ---------- */
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var bookmarks = load("gwd.bookmarks", []);
  var history = load("gwd.history", []);

  /* ---------- alamat ---------- */
  function resolveInput(v) {
    v = (v || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) {
      try { return { url: new URL(v).href }; } catch (e) { return null; }
    }
    if (!/\s/.test(v)) {
      try {
        var u = new URL("https://" + v);
        if (u.hostname.indexOf(".") > 0 || u.hostname === "localhost") return { url: u.href };
      } catch (e) {}
    }
    return { url: SEARCH + encodeURIComponent(v), search: true };
  }

  function frameSrc(url, proxied) { return proxied ? PROXY + "/p/" + url : url; }
  function host(u) { try { return new URL(u).hostname; } catch (e) { return u; } }

  /* ---------- tampilan ---------- */
  function layout() {
    var availW = Math.max(200, stage.clientWidth - 2);
    var w = width || availW, s = Math.min(1, availW / w);
    var h = Math.max(420, stage.clientHeight - (width ? 24 : 2));
    tabs.forEach(function (t) {
      t.pane.style.width = Math.round(w * s) + "px";
      t.pane.style.height = h + "px";
      t.pane.classList.toggle("sized", !!width);
      t.frame.style.width = w + "px";
      t.frame.style.height = Math.round(h / s) + "px";
      t.frame.style.transform = "scale(" + s + ")";
    });
    info.textContent = width ? width + " px" + (s < 1 ? " · diperkecil " + Math.round(s * 100) + "%" : "") : "";
  }

  function say(text, canProxy) {
    clearTimeout(noticeTimer);
    notice.hidden = !text;
    noticeText.textContent = text || "";
    tryProxy.hidden = !canProxy;
  }

  function busy(on) { loadBar.hidden = !on; if (on) { loadBar.style.animation = "none"; void loadBar.offsetWidth; loadBar.style.animation = ""; } }

  function render() {
    tabsEl.textContent = "";
    tabs.forEach(function (t) {
      var b = document.createElement("div");
      b.className = "tab"; b.setAttribute("role", "tab"); b.tabIndex = 0;
      b.setAttribute("aria-selected", t === active ? "true" : "false");
      var s = document.createElement("span"); s.textContent = t.title; s.title = t.title;
      var x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", "Tutup tab");
      x.addEventListener("click", function (e) { e.stopPropagation(); closeTab(t); });
      b.appendChild(s); b.appendChild(x);
      b.addEventListener("click", function () { switchTab(t); });
      b.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTab(t); } });
      tabsEl.appendChild(b);
    });
    var n = document.createElement("button");
    n.className = "newtab"; n.type = "button"; n.textContent = "+"; n.title = "Tab baru"; n.setAttribute("aria-label", "Tab baru");
    n.addEventListener("click", function () { newTab(); });
    tabsEl.appendChild(n);

    tabs.forEach(function (t) { t.pane.hidden = t !== active || !t.url; });
    empty.hidden = !!(active && active.url);
    if (!empty.hidden) renderDial();
    if (document.activeElement !== urlIn) urlIn.value = active && active.url || "";
    backB.disabled = !active || active.idx <= 0;
    fwdB.disabled = !active || active.idx >= active.hist.length - 1;
    reloadB.disabled = !active || !active.url;
    var marked = !!(active && active.url && bookmarks.some(function (b) { return b.url === active.url; }));
    starB.textContent = marked ? "★" : "☆";
    starB.disabled = !active || !active.url;
    openTab.href = active && active.url || "#";
    document.title = (active && active.url ? active.title + " · " : "") + "Browser GoWithDME";
  }

  /* ---------- speed dial ---------- */
  function renderDial() {
    var items = bookmarks.slice(0, 8).map(function (b) { return { url: b.url, label: b.title || host(b.url) }; });
    [["https://id.wikipedia.org", "Wikipedia"], ["https://gowithdme.com", "GoWithDME"], ["https://news.ycombinator.com", "Hacker News"]].forEach(function (d) {
      if (items.length < 8 && !items.some(function (i) { return host(i.url) === host(d[0]); })) items.push({ url: d[0], label: d[1] });
    });
    dial.textContent = "";
    items.forEach(function (i) {
      var b = document.createElement("button"); b.type = "button"; b.title = i.url;
      var ic = document.createElement("i"); ic.textContent = (i.label || host(i.url)).charAt(0) || "?";
      var sp = document.createElement("span"); sp.textContent = i.label;
      b.appendChild(ic); b.appendChild(sp);
      b.addEventListener("click", function () { openIn(i.url); });
      dial.appendChild(b);
    });
  }

  /* ---------- tab ---------- */
  function newTab(url) {
    if (tabs.length >= MAX_TABS) { flash("Maksimal " + MAX_TABS + " tab. Tutup salah satu dulu."); return null; }
    var pane = document.createElement("div");
    pane.className = "pane"; pane.hidden = true;
    var frame = document.createElement("iframe");
    frame.title = "Halaman situs";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads");
    frame.allow = "fullscreen; clipboard-write; autoplay";
    pane.appendChild(frame); stage.appendChild(pane);
    var t = { id: nextId++, title: "Tab baru", url: "", hist: [], idx: -1, pane: pane, frame: frame, proxied: false, pending: false };
    frame.addEventListener("load", function () { if (t === active) busy(false); });
    tabs.push(t);
    T.log("newtab", { meta: { n: tabs.length } });
    switchTab(t);
    layout();
    if (url) go(t, url);
    return t;
  }

  function switchTab(t) { active = t; say(""); busy(false); render(); }

  function closeTab(t) {
    var i = tabs.indexOf(t);
    T.log("closetab", { meta: { n: tabs.length - 1 } });
    t.pane.remove(); tabs.splice(i, 1);
    if (!tabs.length) { active = null; newTab(); return; }
    if (t === active) active = tabs[Math.min(i, tabs.length - 1)];
    render();
  }

  /* ---------- navigasi ---------- */
  function go(t, url, opts) {
    opts = opts || {};
    var proxied = opts.proxied != null ? opts.proxied : modeSel.value === "proxy";
    if (!PROXY) {
      if (opts.search) return say("Pencarian memerlukan proxy. Isi PROXY_URL di js/config.js.");
      proxied = false;
    }
    if (opts.search && PROXY) proxied = true;
    if (!proxied && /^http:\/\//i.test(url)) {
      if (PROXY) proxied = true;
      else return say("Alamat http:// tidak bisa ditampilkan di halaman aman ini. Coba pakai https://");
    }
    /* Moderasi (lunak): "block" ditolak di semua mode. "warn" ditanyakan di mode Langsung; mode Proxy menampilkan peringatan sendiri dari Worker. */
    var rule = window.GWD_MOD && window.GWD_MOD.match(url);
    if (rule && rule.action === "block") return say("Situs ini diblokir oleh admin dan tidak bisa dibuka lewat browser ini.");
    if (rule && rule.action === "warn" && !proxied && !window.GWD_MOD.isAcked(rule.host)) {
      if (!window.confirm(host(url) + " ditandai bermasalah. Jangan memasukkan kata sandi atau data pribadi di sana. Tetap lanjutkan?")) return;
      window.GWD_MOD.ack(rule.host);
    }
    t.proxied = proxied; t.pending = true; t.t0 = Date.now();
    t.url = url; t.title = host(url);
    /* Catat hanya situs & path (tanpa query). Kata pencarian tidak dikirim. */
    T.log(opts.search ? "search" : (opts.fromHistory && opts.reload ? "reload" : "nav"),
      opts.search ? { host: host(url), mode: proxied ? "proxy" : "direct" } : { url: url, mode: proxied ? "proxy" : "direct" });
    if (!opts.fromHistory) {
      t.hist = t.hist.slice(0, t.idx + 1);
      t.hist.push(url); t.idx = t.hist.length - 1;
      remember(url);
    }
    t.frame.referrerPolicy = proxied ? "strict-origin-when-cross-origin" : "no-referrer";
    t.frame.src = frameSrc(url, proxied);
    say(""); busy(true); render(); layout();

    /* Browser tidak memberi tahu bila situs menolak iframe, jadi beri petunjuk setelah beberapa detik. */
    noticeTimer = setTimeout(function () {
      T.log("notice", { url: url, mode: proxied ? "proxy" : "direct", meta: { type: proxied ? "slow_proxy" : "blocked_frame" } });
      busy(false);
      say(proxied
        ? "Halaman lama dimuat atau situs ini menolak proxy. Kamu bisa membukanya langsung."
        : "Layar kosong? Banyak situs melarang tampil di dalam halaman lain.", !proxied && !!PROXY);
    }, 9000);
  }

  function remember(url) {
    history = history.filter(function (h) { return h.url !== url; });
    history.unshift({ url: url, t: Date.now() });
    history = history.slice(0, 100);
    save("gwd.history", history);
  }

  function submit(v) {
    var r = resolveInput(v);
    if (!r) return flash("Alamat tidak valid.");
    if (!active) newTab();
    go(active, r.url, { search: r.search });
  }

  /* Laporan alamat dari halaman yang dimuat lewat proxy (klik tautan di dalam halaman) */
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.gwdProxy !== 1 || e.origin !== PROXY_ORIGIN) return;
    var t = tabs.filter(function (x) { return x.frame.contentWindow === e.source; })[0];
    if (!t || typeof d.url !== "string") return;
    clearTimeout(noticeTimer);
    if (t === active) busy(false);
    if (t.pending && t.t0) { T.log("load", { url: d.url, mode: "proxy", ms: Date.now() - t.t0 }); t.t0 = 0; }
    else if (!t.pending && d.url !== t.url) T.log("nav", { url: d.url, mode: "proxy", meta: { via: "link" } });
    if (d.title) t.title = String(d.title).slice(0, 80);
    if (d.url !== t.url) {
      t.url = d.url;
      if (t.pending) t.hist[t.idx] = d.url;           /* pengalihan: ganti entri */
      else { t.hist = t.hist.slice(0, t.idx + 1); t.hist.push(d.url); t.idx = t.hist.length - 1; }
      remember(d.url);
    }
    t.pending = false;
    if (t === active) say("");
    render();
  });

  /* ---------- menu ---------- */
  function section(title) { var h = document.createElement("h3"); h.textContent = title; menu.appendChild(h); }
  function item(label, fn) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = label;
    b.addEventListener("click", function () { menu.hidden = true; fn(); });
    menu.appendChild(b);
  }
  function none(t) { var p = document.createElement("div"); p.className = "muted"; p.textContent = t; menu.appendChild(p); }

  function openMenu() {
    menu.textContent = "";
    item("Buka di tab baru (browser)", function () { if (active && active.url) window.open(active.url, "_blank", "noopener,noreferrer"); });
    item("Mode fokus (sembunyikan bar)", function () { setFocus(true); });
    item("Layar penuh", function () { var el = active && active.pane; if (el && el.requestFullscreen) el.requestFullscreen(); });
    if (active && active.url && window.GWD_MOD) {
      section("Laporkan situs ini");
      [["berbahaya", "Berbahaya atau malware"], ["penipuan", "Penipuan atau phishing"], ["dewasa", "Konten dewasa"], ["lainnya", "Lainnya"]].forEach(function (r) {
        item(r[1], function () {
          window.GWD_MOD.report(active.url, r[0]).then(function (ok) { flash(ok ? "Terima kasih, laporan terkirim." : "Laporan gagal dikirim. Coba lagi nanti."); });
        });
      });
    }
    section("Tampilan");
    THEMES.forEach(function (t) { item((theme === t ? "\u2713 " : "\u2003") + "Tema " + THEME_LABEL[t].slice(2).toLowerCase(), function () { setTheme(t); }); });
    item((darkPages ? "\u2713 " : "\u2003") + "Gelapkan halaman situs (eksperimental)", function () { setDarkPages(!darkPages); });
    section("Bookmark");
    if (!bookmarks.length) none("Belum ada. Tekan bintang untuk menyimpan.");
    bookmarks.forEach(function (b) { item(b.title || b.url, function () { openIn(b.url); }); });
    section("Riwayat");
    if (!history.length) none("Kosong.");
    history.slice(0, 15).forEach(function (h) { item(h.url, function () { openIn(h.url); }); });
    if (history.length) item("Hapus riwayat", function () { history = []; save("gwd.history", history); });
    menu.hidden = false;
  }
  var darkPages = !!load("gwd.darkpages", false);
  function setDarkPages(on) { darkPages = on; save("gwd.darkpages", on); document.body.classList.toggle("darkpages", on); flash(on ? "Halaman digelapkan (warna gambar bisa terbalik)" : "Halaman kembali normal"); }
  function setFocus(on) { document.body.classList.toggle("focus", on); exitFocus.hidden = !on; setTimeout(layout, 0); if (on) flash("Mode fokus aktif"); }
  function openIn(url) { if (!active) newTab(); go(active, url); }

  /* ---------- peristiwa ---------- */
  themeBtn.addEventListener("click", function () { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % 3]); flash("Tema: " + THEME_LABEL[theme].slice(2)); });
  exitFocus.addEventListener("click", function () { setFocus(false); });
  form.addEventListener("submit", function (e) { e.preventDefault(); submit(urlIn.value); urlIn.blur(); });
  urlIn.addEventListener("focus", function () { urlIn.select(); });
  backB.addEventListener("click", function () { if (active.idx > 0) { active.idx--; go(active, active.hist[active.idx], { fromHistory: true, proxied: active.proxied }); } });
  fwdB.addEventListener("click", function () { if (active.idx < active.hist.length - 1) { active.idx++; go(active, active.hist[active.idx], { fromHistory: true, proxied: active.proxied }); } });
  reloadB.addEventListener("click", function () { if (active && active.url) go(active, active.url, { fromHistory: true, reload: true, proxied: active.proxied }); });
  homeB.addEventListener("click", function () { submit(HOME); });
  tryProxy.addEventListener("click", function () { if (active && active.url) { modeSel.value = "proxy"; go(active, active.url, { fromHistory: true, proxied: true }); } });

  starB.addEventListener("click", function () {
    if (!active || !active.url) return;
    var i = -1;
    bookmarks.forEach(function (b, k) { if (b.url === active.url) i = k; });
    if (i >= 0) { bookmarks.splice(i, 1); flash("Bookmark dihapus"); } else { bookmarks.unshift({ url: active.url, title: active.title }); T.log("bookmark", { url: active.url }); flash("Bookmark disimpan"); }
    save("gwd.bookmarks", bookmarks); render();
  });

  menuB.addEventListener("click", function (e) { e.stopPropagation(); if (menu.hidden) openMenu(); else menu.hidden = true; });
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { menu.hidden = true; if (document.body.classList.contains("focus")) setFocus(false); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") { e.preventDefault(); urlIn.focus(); }
  });

  modeSel.addEventListener("change", function () {
    save("gwd.mode", modeSel.value);
    T.log("mode", { mode: modeSel.value });
    if (active && active.url) go(active, active.url, { fromHistory: true });
  });
  sizeSel.addEventListener("change", function () { width = parseInt(sizeSel.value, 10) || 0; T.log("size", { width: width }); layout(); });
  window.addEventListener("resize", layout);

  /* ---------- mulai ---------- */
  theme = load("gwd.theme", "auto"); applyTheme();
  document.body.classList.toggle("darkpages", darkPages);
  modeSel.value = PROXY ? load("gwd.mode", "proxy") : "direct";
  if (!PROXY) modeSel.querySelector('[value="proxy"]').disabled = true;

  T.log("open", { mode: modeSel.value });
  newTab();
  if (!PROXY) say("Proxy belum diatur, jadi hanya situs yang mengizinkan iframe yang bisa dibuka. Isi PROXY_URL di js/config.js.");
  var q = new URLSearchParams(location.search).get("u");
  if (q) submit(q);
})();
