/* Browser mini: tab, riwayat, bookmark, pencarian, ukuran layar.
   Mode "proxy" memuat situs lewat Worker (worker/proxy.js); mode "direct" memuat langsung.

   Isi file: tema > penyimpanan > alamat > tampilan/layout > tab > navigasi > saran alamat > menu > peristiwa > mulai. */
(function () {
  "use strict";

  var C = window.GWD_CONFIG || {};
  var PROXY = (C.PROXY_URL || "").replace(/\/+$/, "");
  var PROXY_ORIGIN = "";
  try { PROXY_ORIGIN = PROXY ? new URL(PROXY).origin : ""; } catch (e) { PROXY = ""; }
  var SEARCH = C.SEARCH_URL || "https://html.duckduckgo.com/html/?q=";
  var HOME = C.DEFAULT_URL || "https://gowithdme.com";
  var MAX_TABS = 8, MAX_HIST = 100, MAX_TAB_HIST = 30, SLOW_MS = 9000;
  var T = window.GWD_TRACK || { log: function () {} };   /* js/track.js; aman bila tidak dimuat */

  var $ = function (id) { return document.getElementById(id); };
  var tabsEl = $("tabs"), form = $("form"), urlIn = $("url"), stage = $("stage"), empty = $("empty"),
      backB = $("back"), fwdB = $("fwd"), reloadB = $("reload"), homeB = $("home"), starB = $("star"),
      menuB = $("menuBtn"), menu = $("menu"), modeSel = $("mode"), sizeSel = $("size"), info = $("info"),
      loadBar = $("load"), themeBtn = $("themeBtn"), toast = $("toast"), exitFocus = $("exitFocus"),
      dial = $("dial"), notice = $("notice"), noticeText = $("noticeText"), tryProxy = $("tryProxy"),
      openTab = $("openTab"), noticeX = $("noticeX"), secIcon = $("secIcon"), modeChip = $("modeChip"), sugg = $("sugg");

  var tabs = [], active = null, nextId = 1, width = 0, toastTimer = null, saveTimer = null, layoutRaf = 0;

  /* ---------- ikon ---------- */
  var SVGNS = "http://www.w3.org/2000/svg";
  function icon(name, cls) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "ic" + (cls ? " " + cls : ""));
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(SVGNS, "use");
    u.setAttribute("href", "#i-" + name);
    s.appendChild(u);
    return s;
  }
  function setIcon(svg, name) { var u = svg.querySelector("use"); if (u) u.setAttribute("href", "#i-" + name); }

  /* ---------- penyimpanan (semua aman bila localStorage diblokir) ---------- */
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function isHttp(u) {
    if (typeof u !== "string" || u.length > 4096) return false;
    try { var p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch (e) { return false; }
  }
  /* Kembalikan alamat bersih (href) bila http/https, selain itu "" */
  function cleanUrl(u) { return isHttp(u) ? new URL(u).href : ""; }
  function entries(v) {
    return (Array.isArray(v) ? v : []).filter(function (x) { return x && isHttp(x.url); })
      .map(function (x) { return { url: x.url, title: typeof x.title === "string" ? x.title.slice(0, 80) : "", t: +x.t || 0 }; });
  }
  var bookmarks = entries(load("gwd.bookmarks", []));
  var visits = entries(load("gwd.history", []));
  var darkPages = !!load("gwd.darkpages", false);
  var restoreTabs = load("gwd.restore", true) !== false;

  /* ---------- tema ---------- */
  var THEMES = ["auto", "light", "dark"];
  var THEME_LABEL = { auto: "Otomatis", light: "Terang", dark: "Gelap" };
  var THEME_ICON = { auto: "auto", light: "sun", dark: "moon" };
  var theme = "auto", mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
  function applyTheme() {
    var dark = theme === "dark" || (theme === "auto" && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    var m = $("themeColor"); if (m) m.setAttribute("content", dark ? "#161c19" : "#ffffff");
    themeBtn.textContent = "";
    themeBtn.appendChild(icon(THEME_ICON[theme]));
    var sp = document.createElement("span"); sp.textContent = THEME_LABEL[theme];
    themeBtn.appendChild(sp);
    themeBtn.title = "Tema: " + THEME_LABEL[theme] + " (klik untuk ganti)";
  }
  function setTheme(t) { theme = t; save("gwd.theme", t); applyTheme(); }
  if (mq && mq.addEventListener) mq.addEventListener("change", applyTheme);

  function flash(text, ms) {
    toast.textContent = text; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.hidden = true; }, ms || 2200);
  }

  /* ---------- alamat ---------- */
  function resolveInput(v) {
    v = (v || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) {
      var h = cleanUrl(v);
      return h ? { url: h } : null;
    }
    if (!/\s/.test(v) && !/^[a-z][a-z0-9+.-]*:(?!\d+(\/|$))/i.test(v)) {   /* tolak skema lain (javascript:, data:, ...) */
      try {
        var u = new URL("https://" + v);
        if (u.hostname.indexOf(".") > 0 || u.hostname === "localhost") return { url: u.href };
      } catch (e) {}
    }
    return { url: SEARCH + encodeURIComponent(v), search: true };
  }
  function frameSrc(url, proxied) { return proxied ? PROXY + "/p/" + url : url; }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } }

  /* ---------- tampilan ---------- */
  function layout() {
    layoutRaf = 0;
    if (!stage.clientWidth) return;
    var availW = Math.max(200, stage.clientWidth - 2);
    var w = width || availW, s = Math.min(1, availW / w);
    var h = Math.max(320, stage.clientHeight - (width ? 26 : 2));
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
  function queueLayout() { if (!layoutRaf) layoutRaf = requestAnimationFrame(layout); }

  /* Pemberitahuan dan indikator muat disimpan per tab, jadi tab lain tidak ikut terpengaruh */
  function setNotice(t, text, canProxy) {
    t.notice = text ? { text: text, canProxy: !!canProxy } : null;
    if (t === active) paintNotice();
  }
  function paintNotice() {
    var n = active && active.notice;
    notice.hidden = !n;
    noticeText.textContent = n ? n.text : "";
    tryProxy.hidden = !(n && n.canProxy);
  }
  function setLoading(t, on) {
    if (t.loading === on) return;
    t.loading = on;
    paintTab(t);
    if (t === active) { paintBusy(); paintToolbar(); }
  }
  function paintBusy() {
    var on = !!(active && active.loading);
    loadBar.hidden = !on;
    if (on) { loadBar.style.animation = "none"; void loadBar.offsetWidth; loadBar.style.animation = ""; }
  }
  function clearTimer(t) { if (t.timer) { clearTimeout(t.timer); t.timer = 0; } }

  /* ---------- tab ---------- */
  var newBtn = document.createElement("button");
  newBtn.className = "newtab"; newBtn.type = "button"; newBtn.title = "Tab baru (Alt+T)"; newBtn.setAttribute("aria-label", "Tab baru");
  newBtn.appendChild(icon("plus"));
  newBtn.addEventListener("click", userNewTab);

  function buildTabEl(t) {
    var b = document.createElement("div");
    b.className = "tab"; b.setAttribute("role", "tab");
    var fav = document.createElement("span"); fav.className = "fav"; fav.setAttribute("aria-hidden", "true");
    var s = document.createElement("span"); s.className = "ttl";
    var x = document.createElement("button"); x.className = "x"; x.type = "button"; x.tabIndex = -1;
    x.setAttribute("aria-label", "Tutup tab"); x.title = "Tutup tab (Alt+W)"; x.appendChild(icon("x"));
    x.addEventListener("click", function (e) { e.stopPropagation(); closeTab(t); });
    b.appendChild(fav); b.appendChild(s); b.appendChild(x);
    b.addEventListener("click", function () { switchTab(t); });
    b.addEventListener("auxclick", function (e) { if (e.button === 1) { e.preventDefault(); closeTab(t); } });
    b.addEventListener("mousedown", function (e) { if (e.button === 1) e.preventDefault(); });
    b.addEventListener("keydown", function (e) {
      var i = tabs.indexOf(t), n = null;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTab(t); return; }
      if (e.key === "Delete") { e.preventDefault(); closeTab(t); return; }
      if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") n = tabs[0];
      else if (e.key === "End") n = tabs[tabs.length - 1];
      if (n) { e.preventDefault(); switchTab(n); n.el.focus(); }
    });
    t.el = b; t.elFav = fav; t.elTitle = s;
  }

  function paintTab(t) {
    var sel = t === active, label = t.url ? t.title : "Tab baru";
    t.el.setAttribute("aria-selected", sel ? "true" : "false");
    t.el.tabIndex = sel ? 0 : -1;
    t.el.classList.toggle("loading", !!t.loading);
    t.el.classList.toggle("new", !t.url);
    t.elTitle.textContent = label;
    t.el.title = t.url ? label + "\n" + t.url : label;
    t.elFav.textContent = t.url ? (host(t.url).charAt(0) || "?") : "+";
  }

  function renderTabs() {
    var want = tabs.map(function (t) { return t.el; }); want.push(newBtn);
    var same = want.length === tabsEl.children.length && want.every(function (e, i) { return tabsEl.children[i] === e; });
    if (!same) { tabsEl.textContent = ""; want.forEach(function (e) { tabsEl.appendChild(e); }); }
    tabs.forEach(paintTab);
    if (active) { try { active.el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {} }
  }

  function paintToolbar() {
    var u = active && active.url || "";
    backB.disabled = !active || active.idx <= 0;
    fwdB.disabled = !active || active.idx >= active.hist.length - 1;
    var busyNow = !!(active && active.loading);
    reloadB.disabled = !active || (!active.url && !busyNow);
    setIcon(reloadB.querySelector("svg"), busyNow ? "x" : "reload");
    reloadB.title = busyNow ? "Hentikan" : "Muat ulang"; reloadB.setAttribute("aria-label", reloadB.title);
    var marked = !!(u && bookmarks.some(function (b) { return b.url === u; }));
    starB.classList.toggle("on", marked); starB.setAttribute("aria-pressed", marked ? "true" : "false");
    starB.title = marked ? "Hapus bookmark" : "Simpan bookmark";
    starB.disabled = !u;
    openTab.href = u || "#";
    /* ikon & lencana di bar alamat */
    var https = /^https:/i.test(u);
    setIcon(secIcon, !u ? "search" : https ? "lock" : "globe");
    secIcon.classList.toggle("ok", !!u && https);
    modeChip.hidden = !u;
    if (u) { modeChip.textContent = active.proxied ? "Proxy" : "Langsung"; modeChip.classList.toggle("direct", !active.proxied); }
    if (document.activeElement !== urlIn) urlIn.value = u;
  }

  function render() {
    renderTabs();
    tabs.forEach(function (t) { t.pane.hidden = t !== active || !t.url; });
    empty.hidden = !!(active && active.url);
    if (!empty.hidden) renderDial();
    paintToolbar(); paintNotice(); paintBusy();
    document.title = (active && active.url ? active.title + " · " : "") + "Browser GoWithDME";
    saveTabsSoon();
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

  /* ---------- simpan & pulihkan tab ---------- */
  function saveTabsSoon() {
    if (!restoreTabs) return;
    clearTimeout(saveTimer); saveTimer = setTimeout(saveTabsNow, 400);
  }
  function saveTabsNow() {
    clearTimeout(saveTimer);
    if (!restoreTabs) return;
    var list = tabs.filter(function (t) { return t.url; });
    save("gwd.tabs", {
      a: Math.max(0, list.indexOf(active)),
      t: list.map(function (t) {
        var h = t.hist.slice(-MAX_TAB_HIST);
        return { url: t.url, title: t.title, p: t.proxied, h: h, i: Math.max(0, h.length - (t.hist.length - t.idx)) };
      })
    });
  }
  function restore() {
    var s = load("gwd.tabs", null);
    if (!s || !Array.isArray(s.t)) return false;
    s.t.slice(0, MAX_TABS).forEach(function (o) {
      if (!o || !isHttp(o.url)) return;
      var t = makeTab();
      t.url = o.url; t.title = String(o.title || host(o.url)).slice(0, 80); t.proxied = !!o.p;
      var h = Array.isArray(o.h) ? o.h.filter(isHttp).slice(-MAX_TAB_HIST) : [];
      var i = +o.i;
      if (!h.length || !(i >= 0 && i < h.length) || h[i] !== o.url) { h = [o.url]; i = 0; }
      t.hist = h; t.idx = i; t.lazy = true;     /* dimuat saat tabnya dibuka, supaya awal cepat */
    });
    if (!tabs.length) return false;
    var a = Math.min(Math.max(0, +s.a || 0), tabs.length - 1);
    switchTab(tabs[a]);
    return true;
  }

  /* ---------- tab: buat, ganti, tutup ---------- */
  function makeTab() {
    var pane = document.createElement("div");
    pane.className = "pane"; pane.hidden = true;
    var frame = document.createElement("iframe");
    frame.title = "Halaman situs";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads");
    frame.allow = "fullscreen; clipboard-write; autoplay";
    pane.appendChild(frame); stage.appendChild(pane);
    var t = { id: nextId++, title: "Tab baru", url: "", hist: [], idx: -1, pane: pane, frame: frame,
              proxied: false, pending: false, loading: false, lazy: false, blank: false, notice: null, timer: 0, t0: 0 };
    buildTabEl(t);
    frame.addEventListener("load", function () {
      if (t.blank || !t.url || !frame.getAttribute("src")) return;   /* abaikan about:blank (awal atau hasil Hentikan) */
      setLoading(t, false);
    });
    tabs.push(t);
    return t;
  }

  function newTab(url) {
    if (tabs.length >= MAX_TABS) { flash("Maksimal " + MAX_TABS + " tab. Tutup salah satu dulu."); return null; }
    var t = makeTab();
    T.log("newtab", { meta: { n: tabs.length } });
    switchTab(t);
    layout();
    if (url) go(t, url);
    return t;
  }
  /* Tab baru dari tindakan pengguna: langsung fokus ke bar alamat (tidak dipakai saat awal, agar keyboard HP tidak muncul sendiri) */
  function userNewTab() { if (newTab()) urlIn.focus(); }

  function switchTab(t) {
    active = t;
    render();
    if (t.lazy) { t.lazy = false; go(t, t.url, { fromHistory: true, proxied: t.proxied }); }
  }

  function closeTab(t) {
    var i = tabs.indexOf(t);
    if (i < 0) return;
    T.log("closetab", { meta: { n: tabs.length - 1 } });
    clearTimer(t);
    t.pane.remove(); tabs.splice(i, 1);
    if (!tabs.length) { active = null; newTab(); return; }
    if (t === active) switchTab(tabs[Math.min(i, tabs.length - 1)]); else render();
  }

  /* ---------- navigasi ---------- */
  function go(t, url, opts) {
    opts = opts || {};
    if (!isHttp(url)) return flash("Alamat tidak valid.");
    var proxied = opts.proxied != null ? opts.proxied : modeSel.value === "proxy";
    if (!PROXY) {
      if (opts.search) return setNotice(t, "Pencarian memerlukan proxy. Isi PROXY_URL di js/config.js.");
      proxied = false;
    }
    if (opts.search && PROXY) proxied = true;
    if (!proxied && /^http:\/\//i.test(url)) {
      if (PROXY) proxied = true;
      else return setNotice(t, "Alamat http:// tidak bisa ditampilkan di halaman aman ini. Coba pakai https://");
    }
    if (navigator.onLine === false) return setNotice(t, "Tidak ada koneksi internet. Periksa jaringanmu lalu coba lagi.");

    /* Moderasi (lunak): "block" ditolak di semua mode. "warn" ditanyakan di mode Langsung; mode Proxy menampilkan peringatan sendiri dari Worker. */
    var rule = window.GWD_MOD && window.GWD_MOD.match(url);
    if (rule && rule.action === "block") return setNotice(t, "Situs ini diblokir oleh admin dan tidak bisa dibuka lewat browser ini.");
    if (rule && rule.action === "warn" && !proxied && !window.GWD_MOD.isAcked(rule.host)) {
      if (!window.confirm(host(url) + " ditandai bermasalah. Jangan memasukkan kata sandi atau data pribadi di sana. Tetap lanjutkan?")) return;
      window.GWD_MOD.ack(rule.host);
    }

    clearTimer(t);
    t.proxied = proxied; t.pending = true; t.t0 = Date.now(); t.blank = false;
    t.url = url; t.title = host(url);
    /* Catat hanya situs & path (tanpa query). Kata pencarian tidak dikirim. */
    T.log(opts.search ? "search" : (opts.fromHistory && opts.reload ? "reload" : "nav"),
      opts.search ? { host: host(url), mode: proxied ? "proxy" : "direct" } : { url: url, mode: proxied ? "proxy" : "direct" });
    if (!opts.fromHistory) {
      t.hist = t.hist.slice(0, t.idx + 1);
      t.hist.push(url); t.idx = t.hist.length - 1;
      if (t.hist.length > MAX_TAB_HIST * 2) { t.hist = t.hist.slice(-MAX_TAB_HIST); t.idx = t.hist.length - 1; }
      remember(url);
    }
    t.frame.referrerPolicy = proxied ? "strict-origin-when-cross-origin" : "no-referrer";
    t.frame.src = frameSrc(url, proxied);
    setNotice(t, "");
    setLoading(t, true);
    render(); layout();

    /* Browser tidak memberi tahu bila situs menolak iframe, jadi beri petunjuk setelah beberapa detik. */
    t.timer = setTimeout(function () {
      t.timer = 0;
      if (t.url !== url) return;
      T.log("notice", { url: url, mode: proxied ? "proxy" : "direct", meta: { type: proxied ? "slow_proxy" : "blocked_frame" } });
      setLoading(t, false);
      setNotice(t, proxied
        ? "Halaman lama dimuat atau situs ini menolak proxy. Kamu bisa membukanya langsung."
        : "Layar kosong? Banyak situs melarang tampil di dalam halaman lain.", !proxied && !!PROXY);
    }, SLOW_MS);
  }

  function stopTab(t) {
    if (!t || !t.loading) return;
    clearTimer(t);
    t.blank = true; t.pending = false;
    t.frame.src = "about:blank";
    setLoading(t, false);
    flash("Pemuatan dihentikan");
  }

  function reloadTab(t) { if (t && t.url) go(t, t.url, { fromHistory: true, reload: true, proxied: t.proxied }); }
  function goBack(t) { if (t && t.idx > 0) { t.idx--; go(t, t.hist[t.idx], { fromHistory: true, proxied: t.proxied }); } }
  function goFwd(t) { if (t && t.idx < t.hist.length - 1) { t.idx++; go(t, t.hist[t.idx], { fromHistory: true, proxied: t.proxied }); } }

  function remember(url, title) {
    visits = visits.filter(function (h) { return h.url !== url; });
    visits.unshift({ url: url, title: title || "", t: Date.now() });
    visits = visits.slice(0, MAX_HIST);
    save("gwd.history", visits);
  }

  function submit(v) {
    var r = resolveInput(v);
    if (!r) return flash("Alamat tidak valid.");
    if (!active) newTab();
    go(active, r.url, { search: r.search });
  }
  function openIn(url) { if (!active) newTab(); go(active, url); }

  /* Laporan alamat dari halaman yang dimuat lewat proxy (klik tautan di dalam halaman).
     Asal pesan diperiksa dan alamatnya divalidasi: skrip situs yang diproxy berjalan di asal proxy dan bisa mengirim pesan apa saja. */
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.gwdProxy !== 1 || e.origin !== PROXY_ORIGIN) return;
    var t = tabs.filter(function (x) { return x.frame.contentWindow === e.source; })[0];
    var nu = t && cleanUrl(d.url);
    if (!t || !nu) return;
    clearTimer(t);
    setLoading(t, false);
    setNotice(t, "");
    if (t.pending && t.t0) { T.log("load", { url: nu, mode: "proxy", ms: Date.now() - t.t0 }); t.t0 = 0; }
    else if (!t.pending && nu !== t.url) T.log("nav", { url: nu, mode: "proxy", meta: { via: "link" } });
    if (d.title) t.title = String(d.title).replace(/\s+/g, " ").trim().slice(0, 80) || host(nu);
    if (nu !== t.url) {
      t.url = nu;
      if (t.pending) t.hist[t.idx] = nu;           /* pengalihan: ganti entri */
      else { t.hist = t.hist.slice(0, t.idx + 1); t.hist.push(nu); t.idx = t.hist.length - 1; }
      remember(nu, t.title);
    } else if (t.title) {
      remember(nu, t.title);
    }
    t.pending = false;
    render();
  });

  /* ---------- saran alamat ---------- */
  var suggItems = [], suggIdx = -1;
  function hideSugg() {
    suggItems = []; suggIdx = -1; sugg.hidden = true; sugg.textContent = "";
    urlIn.setAttribute("aria-expanded", "false"); urlIn.removeAttribute("aria-activedescendant");
  }
  function showSugg() {
    var q = urlIn.value.trim().toLowerCase();
    var out = [], seen = {};
    function add(x, star) {
      if (out.length >= 7 || seen[x.url]) return;
      if (((x.url + " " + (x.title || "")).toLowerCase()).indexOf(q) < 0) return;
      seen[x.url] = 1; out.push({ url: x.url, title: x.title || host(x.url), star: star });
    }
    if (q && q !== (active && active.url || "").toLowerCase()) {
      bookmarks.forEach(function (b) { add(b, true); });
      visits.forEach(function (h) { add(h, false); });
    }
    suggItems = out; suggIdx = -1; sugg.textContent = "";
    if (!out.length) { hideSugg(); return; }
    out.forEach(function (o, i) {
      var li = document.createElement("li"); li.id = "sg" + i; li.setAttribute("role", "option"); li.setAttribute("aria-selected", "false");
      if (o.star) li.className = "st";
      li.appendChild(icon(o.star ? "star" : "history"));
      var b = document.createElement("b"); b.textContent = o.title.length > 40 ? o.title.slice(0, 40) + "…" : o.title;
      var s = document.createElement("small"); s.textContent = o.url.replace(/^https?:\/\//, "");
      li.appendChild(b); li.appendChild(s);
      li.addEventListener("mousedown", function (e) { e.preventDefault(); });   /* jaga fokus input */
      li.addEventListener("click", function () { hideSugg(); urlIn.blur(); openIn(o.url); });
      sugg.appendChild(li);
    });
    sugg.hidden = false; urlIn.setAttribute("aria-expanded", "true");
  }
  function moveSugg(d) {
    if (!suggItems.length) return;
    var kids = sugg.children;
    if (suggIdx >= 0) kids[suggIdx].setAttribute("aria-selected", "false");
    suggIdx = (suggIdx + d + suggItems.length + 1) % (suggItems.length + 1);
    if (suggIdx === suggItems.length) suggIdx = -1;     /* putaran: kembali ke teks asli */
    if (suggIdx >= 0) {
      kids[suggIdx].setAttribute("aria-selected", "true");
      urlIn.setAttribute("aria-activedescendant", kids[suggIdx].id);
      try { kids[suggIdx].scrollIntoView({ block: "nearest" }); } catch (e) {}
    } else urlIn.removeAttribute("aria-activedescendant");
  }

  /* ---------- menu ---------- */
  function section(title) { var h = document.createElement("h3"); h.textContent = title; menu.appendChild(h); }
  function item(label, fn, o) {
    o = o || {};
    var row = document.createElement("div"); row.className = "row" + (o.danger ? " danger" : ""); row.setAttribute("role", "none");
    var b = document.createElement("button"); b.type = "button"; b.className = "mi"; b.setAttribute("role", o.check != null ? "menuitemcheckbox" : "menuitem");
    if (o.check != null) b.setAttribute("aria-checked", o.check ? "true" : "false");
    b.title = o.title || label;
    if (o.icon) b.appendChild(icon(o.icon));
    var l = document.createElement("span"); l.className = "lbl"; l.textContent = label; b.appendChild(l);
    if (o.check) { var c = document.createElement("span"); c.className = "ck"; c.textContent = "✓"; b.appendChild(c); }
    b.addEventListener("click", function () { closeMenu(false); fn(); });
    row.appendChild(b);
    if (o.remove) {
      var r = document.createElement("button"); r.type = "button"; r.className = "rm"; r.setAttribute("aria-label", "Hapus " + label); r.title = "Hapus"; r.tabIndex = -1;
      r.appendChild(icon("x"));
      r.addEventListener("click", function (e) { e.stopPropagation(); var y = menu.scrollTop; o.remove(); openMenu(true); menu.scrollTop = y; });
      row.appendChild(r);
    }
    menu.appendChild(row);
  }
  function none(t) { var p = document.createElement("div"); p.className = "muted"; p.textContent = t; menu.appendChild(p); }

  function openMenu(keepFocus) {
    menu.textContent = "";
    var has = !!(active && active.url);
    item("Tab baru", userNewTab, { icon: "plus" });
    item("Buka di tab browser (jendela baru)", function () { if (has) window.open(active.url, "_blank", "noopener,noreferrer"); }, { icon: "ext" });
    item("Mode fokus (sembunyikan bar)", function () { setFocus(true); }, { icon: "globe" });
    item("Layar penuh", function () { var el = active && active.pane; if (el && el.requestFullscreen) el.requestFullscreen().catch(function () {}); else flash("Layar penuh tidak didukung di perangkat ini."); }, { icon: "ext" });
    if (has && window.GWD_MOD) {
      section("Laporkan situs ini");
      [["berbahaya", "Berbahaya atau malware"], ["penipuan", "Penipuan atau phishing"], ["dewasa", "Konten dewasa"], ["lainnya", "Lainnya"]].forEach(function (r) {
        item(r[1], function () {
          window.GWD_MOD.report(active.url, r[0]).then(function (ok) { flash(ok ? "Terima kasih, laporan terkirim." : "Laporan gagal dikirim. Coba lagi nanti."); });
        }, { icon: "alert" });
      });
    }
    section("Tampilan & pengaturan");
    THEMES.forEach(function (t) { item("Tema " + THEME_LABEL[t].toLowerCase(), function () { setTheme(t); }, { icon: THEME_ICON[t], check: theme === t }); });
    item("Gelapkan halaman situs (eksperimental)", function () { setDarkPages(!darkPages); }, { icon: "moon", check: darkPages });
    item("Ingat tab saat dibuka lagi", function () { setRestore(!restoreTabs); }, { icon: "history", check: restoreTabs });
    section("Bookmark");
    if (!bookmarks.length) none("Belum ada. Tekan bintang untuk menyimpan.");
    bookmarks.slice(0, 20).forEach(function (b) {
      item(b.title || b.url, function () { openIn(b.url); }, { icon: "star", title: b.url, remove: function () { bookmarks = bookmarks.filter(function (x) { return x !== b; }); save("gwd.bookmarks", bookmarks); paintToolbar(); if (!empty.hidden) renderDial(); } });
    });
    section("Riwayat");
    if (!visits.length) none("Kosong.");
    visits.slice(0, 15).forEach(function (h) { item(h.title || host(h.url), function () { openIn(h.url); }, { icon: "history", title: h.url }); });
    if (visits.length) item("Hapus riwayat", function () { visits = []; save("gwd.history", visits); flash("Riwayat dihapus"); }, { danger: true });
    if (window.matchMedia && matchMedia("(max-width:700px)").matches) {   /* footer disembunyikan di HP */
      section("Informasi");
      [["privasi", "Privasi"], ["syarat", "Syarat & Ketentuan"], ["larangan", "Penggunaan terlarang"], ["proxy", "Mode proxy"], ["pelacakan", "Pengaturan pelacakan"], ["kontak", "Kontak"]].forEach(function (l) {
        item(l[1], function () { window.open("legal.html#" + l[0], "_blank", "noopener"); }, { icon: "ext" });
      });
      none("\u00a9 2026 GoWithDME. Situs yang dibuka adalah tanggung jawab pemiliknya. Lalu lintas dicatat secara anonim.");
    }
    menu.hidden = false; menuB.setAttribute("aria-expanded", "true");
    if (!keepFocus) { var f = menu.querySelector(".mi"); if (f) f.focus({ preventScroll: true }); }
  }
  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true; menuB.setAttribute("aria-expanded", "false");
    if (refocus) menuB.focus();
  }

  function setDarkPages(on) { darkPages = on; save("gwd.darkpages", on); document.body.classList.toggle("darkpages", on); flash(on ? "Halaman digelapkan (warna gambar bisa terbalik)" : "Halaman kembali normal"); }
  function setRestore(on) { restoreTabs = on; save("gwd.restore", on); if (!on) { try { localStorage.removeItem("gwd.tabs"); } catch (e) {} } else saveTabsNow(); flash(on ? "Tab akan diingat" : "Tab tidak lagi diingat"); }
  function setFocus(on) { document.body.classList.toggle("focus", on); exitFocus.hidden = !on; queueLayout(); if (on) flash("Mode fokus aktif. Tekan Esc untuk keluar."); else if (active) urlIn.blur(); }

  /* ---------- peristiwa ---------- */
  themeBtn.addEventListener("click", function () { setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]); flash("Tema: " + THEME_LABEL[theme]); });
  exitFocus.addEventListener("click", function () { setFocus(false); });
  noticeX.addEventListener("click", function () { if (active) setNotice(active, ""); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var pick = suggIdx >= 0 ? suggItems[suggIdx] : null;
    hideSugg();
    if (pick) openIn(pick.url); else submit(urlIn.value);
    urlIn.blur();
  });
  urlIn.addEventListener("focus", function () { setTimeout(function () { if (document.activeElement === urlIn) urlIn.select(); }, 0); });
  urlIn.addEventListener("blur", function () { hideSugg(); paintToolbar(); });
  urlIn.addEventListener("input", showSugg);
  urlIn.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (sugg.hidden) showSugg(); moveSugg(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSugg(-1); }
    else if (e.key === "Escape") { if (!sugg.hidden) { e.stopPropagation(); hideSugg(); } else { urlIn.blur(); } }
  });

  backB.addEventListener("click", function () { goBack(active); });
  fwdB.addEventListener("click", function () { goFwd(active); });
  reloadB.addEventListener("click", function () { if (active && active.loading) stopTab(active); else reloadTab(active); });
  homeB.addEventListener("click", function () { submit(HOME); });
  tryProxy.addEventListener("click", function () { if (active && active.url) { modeSel.value = "proxy"; go(active, active.url, { fromHistory: true, proxied: true }); } });

  starB.addEventListener("click", function () {
    if (!active || !active.url) return;
    var i = -1;
    bookmarks.forEach(function (b, k) { if (b.url === active.url) i = k; });
    if (i >= 0) { bookmarks.splice(i, 1); flash("Bookmark dihapus"); }
    else { bookmarks.unshift({ url: active.url, title: active.title, t: Date.now() }); T.log("bookmark", { url: active.url }); flash("Bookmark disimpan"); }
    save("gwd.bookmarks", bookmarks); paintToolbar();
  });

  menuB.addEventListener("click", function (e) { e.stopPropagation(); if (menu.hidden) openMenu(); else closeMenu(true); });
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) closeMenu(false); });
  /* Klik di dalam iframe tidak sampai ke dokumen ini, tapi jendela ini kehilangan fokus. */
  window.addEventListener("blur", function () { closeMenu(false); });
  menu.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    var its = Array.prototype.slice.call(menu.querySelectorAll(".mi")), i = its.indexOf(document.activeElement);
    if (!its.length) return;
    e.preventDefault();
    if (e.key === "Home") i = 0; else if (e.key === "End") i = its.length - 1;
    else i = (i + (e.key === "ArrowDown" ? 1 : -1) + its.length) % its.length;
    its[i].focus();
  });

  document.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if (e.key === "Escape") {
      if (!menu.hidden) closeMenu(true);
      else if (document.body.classList.contains("focus")) setFocus(false);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === "l") { e.preventDefault(); urlIn.focus(); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (k === "t") { e.preventDefault(); userNewTab(); }
    else if (k === "w") { e.preventDefault(); if (active) closeTab(active); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); goBack(active); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goFwd(active); }
  });

  modeSel.addEventListener("change", function () {
    save("gwd.mode", modeSel.value);
    T.log("mode", { mode: modeSel.value });
    if (active && active.url) go(active, active.url, { fromHistory: true });
  });
  sizeSel.addEventListener("change", function () {
    width = parseInt(sizeSel.value, 10) || 0; save("gwd.size", width);
    T.log("size", { width: width }); layout();
  });

  if (window.ResizeObserver) new ResizeObserver(queueLayout).observe(stage);
  window.addEventListener("resize", queueLayout);
  window.addEventListener("pagehide", saveTabsNow);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveTabsNow(); });
  window.addEventListener("offline", function () { flash("Kamu sedang offline", 3500); });
  window.addEventListener("online", function () { flash("Kembali online"); });

  /* ---------- mulai ---------- */
  theme = load("gwd.theme", "auto"); if (THEMES.indexOf(theme) < 0) theme = "auto"; applyTheme();
  document.body.classList.toggle("darkpages", darkPages);
  var savedMode = load("gwd.mode", "proxy");
  modeSel.value = PROXY && savedMode === "direct" ? "direct" : (PROXY ? "proxy" : "direct");
  if (!PROXY) modeSel.querySelector('[value="proxy"]').disabled = true;
  var savedSize = String(load("gwd.size", 0));
  if (sizeSel.querySelector('[value="' + savedSize + '"]')) { sizeSel.value = savedSize; width = parseInt(savedSize, 10) || 0; }

  T.log("open", { mode: modeSel.value });
  var q = new URLSearchParams(location.search).get("u");
  var restored = restoreTabs && !q && restore();     /* dengan ?u= mulai bersih di tab baru */
  if (!restored) newTab();
  layout();
  if (!PROXY && active) setNotice(active, "Proxy belum diatur, jadi hanya situs yang mengizinkan iframe yang bisa dibuka. Isi PROXY_URL di js/config.js.");
  if (q) {
    try { window.history.replaceState(null, "", location.pathname); } catch (e) {}
    submit(q);
  }
})();
