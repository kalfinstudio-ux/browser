/* Proxy pembuka situs untuk iframe (Cloudflare Worker).
   Alamat:  https://<worker>/p/https://contoh.com/halaman?x=1
   - Menghapus X-Frame-Options dan Content-Security-Policy dari situs tujuan.
   - Menulis ulang tautan, gambar, skrip, CSS, dan form di HTML agar tetap lewat proxy.
   - Menyuntik skrip kecil untuk fetch/XHR/window.open dan melaporkan alamat halaman ke induk.
   - Tidak meneruskan cookie (tidak ada login lewat proxy).
   - Hanya melayani permintaan dari ALLOWED_ORIGINS, menolak alamat jaringan internal. */

const PREFIX = "/p/";

/* ---------- pembantu (diekspor untuk pengujian) ---------- */

export function blockedHost(h) {
  h = String(h).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.indexOf(".") < 0 && h.indexOf(":") < 0) return true;
  if (h.indexOf(":") >= 0) return h === "::1" || h === "::" || /^(fc|fd|fe[89ab]|::ffff)/.test(h);
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

export function proxify(val, base, origin) {
  val = String(val || "").trim();
  if (!val || /^(#|data:|blob:|javascript:|mailto:|tel:|about:|sms:)/i.test(val)) return val;
  try {
    const u = new URL(val, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return val;
    if (u.origin === origin && u.pathname.indexOf(PREFIX) === 0) return u.href;
    return origin + PREFIX + u.href;
  } catch (e) { return val; }
}

export function rewriteSrcset(val, base, origin) {
  return val.split(",").map(function (part) {
    const t = part.trim().split(/\s+/);
    if (!t[0]) return "";
    t[0] = proxify(t[0], base, origin);
    return t.join(" ");
  }).filter(Boolean).join(", ");
}

export function rewriteCss(css, base, origin) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
      return "url(" + q + proxify(u, base, origin) + q + ")";
    })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, function (m, q, u) {
      return "@import " + q + proxify(u, base, origin) + q;
    });
}

/* "/p/https:/x.com" (garis ganda diciutkan) -> "https://x.com" */
export function targetFromPath(pathname, search) {
  let t = pathname.slice(PREFIX.length) + search;
  t = t.replace(/^(https?):\/+/i, "$1://");
  return t;
}

function isAllowed(req, env, url) {
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const ref = req.headers.get("referer");
  if (!ref) return false;
  try {
    const o = new URL(ref).origin;
    return o === url.origin || list.indexOf(o) >= 0;
  } catch (e) { return false; }
}

function text(status, body) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });
}

/* Skrip yang disuntik ke setiap halaman HTML. ES5 agar jalan di mana saja. */
const INJECT = "<script>(function(){" +
  "var O=location.origin;" +
  "function real(){return (location.pathname.slice(3)+location.search).replace(/^(https?):\\/+/i,'$1://')}" +
  "function px(u){try{var s=String(u);if(!s||/^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(s))return u;" +
  "var a=new URL(s,real());if(a.protocol!=='http:'&&a.protocol!=='https:')return u;" +
  "if(a.origin===O&&a.pathname.indexOf('/p/')===0)return a.href;return O+'/p/'+a.href}catch(e){return u}}" +
  "try{var F=window.fetch;if(F)window.fetch=function(i,o){try{if(typeof i==='string'||i instanceof URL)i=px(i);" +
  "else if(i&&i.url){var n=px(i.url);if(n!==i.url)i=new Request(n,i)}}catch(e){}return F.call(this,i,o)}}catch(e){}" +
  "try{var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=px(u);return X.apply(this,arguments)}}catch(e){}" +
  "try{var W=window.open;window.open=function(u){if(u)arguments[0]=px(u);return W.apply(this,arguments)}}catch(e){}" +
  "try{var S=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){" +
  "if(typeof v==='string'&&/^(src|href|action|poster|data)$/i.test(n))v=px(v);return S.call(this,n,v)}}catch(e){}" +
  "[['HTMLImageElement','src'],['HTMLScriptElement','src'],['HTMLIFrameElement','src'],['HTMLLinkElement','href']," +
  "['HTMLSourceElement','src'],['HTMLMediaElement','src'],['HTMLAnchorElement','href'],['HTMLFormElement','action']].forEach(function(p){" +
  "try{var d=Object.getOwnPropertyDescriptor(window[p[0]].prototype,p[1]);if(!d||!d.set)return;" +
  "Object.defineProperty(window[p[0]].prototype,p[1],{get:d.get,configurable:true,enumerable:d.enumerable," +
  "set:function(v){d.set.call(this,typeof v==='string'?px(v):v)}})}catch(e){}});" +
  "['pushState','replaceState'].forEach(function(k){try{var H=history[k];history[k]=function(s,t,u){" +
  "var r=H.call(this,s,t,u==null?u:px(u));tell();return r}}catch(e){}});" +
  "function tell(){try{parent.postMessage({gwdProxy:1,url:real(),title:document.title||''},'*')}catch(e){}}" +
  "addEventListener('DOMContentLoaded',tell);addEventListener('load',tell);addEventListener('popstate',tell);tell();" +
  "})();</script>";

/* ---------- pencatat lalu lintas ke Supabase (opsional) ----------
   Aktif bila SUPABASE_URL, SUPABASE_ANON_KEY (vars) dan LOG_SECRET (secret) terisi.
   Dikirim lewat ctx.waitUntil sehingga tidak memperlambat respons. Tanpa IP, tanpa query, tanpa isi halaman. */

export function buildLog(kind, t, status, ms, bytes, meta) {
  const rec = { src: "proxy", kind: kind, host: t ? t.hostname : "", path: t ? t.pathname : "", mode: "proxy", status: status, ms: Math.round(ms) };
  if (bytes > 0) rec.bytes = bytes;
  if (meta) rec.meta = meta;
  return rec;
}

function sendLog(env, ctx, rec) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.LOG_SECRET) return;
  const p = fetch(String(env.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/rpc/browser_log", {
    method: "POST",
    headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ p_events: [rec], p_secret: env.LOG_SECRET })
  }).catch(function () {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

/* Dokumen (halaman) dan semua galat selalu dicatat; berkas pendukung (gambar, CSS, JS) disampel agar baris tidak membengkak. */
function shouldLog(env, kind, status) {
  if (kind !== "asset" || status >= 400) return true;
  const r = parseFloat(env.LOG_ASSET_SAMPLE);
  return Math.random() < (isNaN(r) ? 0.1 : Math.max(0, Math.min(1, r)));
}

/* ---------- penangan utama ---------- */

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });

    if (url.pathname === "/" || url.pathname === "/favicon.ico") {
      return text(url.pathname === "/" ? 200 : 204, url.pathname === "/" ? "GoWithDME proxy aktif." : "");
    }
    if (!isAllowed(req, env, url)) return text(403, "Akses proxy ditolak: asal permintaan tidak diizinkan.");

    let target;
    if (url.pathname.indexOf(PREFIX) === 0) {
      target = targetFromPath(url.pathname, url.search);
    } else {
      /* Alamat "/foo" dari skrip halaman: cari asalnya lewat Referer */
      const ref = req.headers.get("referer");
      try {
        const r = new URL(ref);
        if (r.origin !== url.origin || r.pathname.indexOf(PREFIX) !== 0) return text(404, "Tidak ditemukan.");
        const real = targetFromPath(r.pathname, r.search);
        return Response.redirect(proxify(new URL(url.pathname + url.search, real).href, real, url.origin), 307);
      } catch (e) { return text(404, "Tidak ditemukan."); }
    }

    let t;
    try { t = new URL(target); } catch (e) { return text(400, "Alamat tidak valid."); }
    if ((t.protocol !== "http:" && t.protocol !== "https:") || blockedHost(t.hostname)) {
      sendLog(env, ctx, buildLog("error", t, 403, 0, 0, { reason: "blocked" }));
      return text(403, "Alamat ini tidak diizinkan.");
    }

    const h = new Headers();
    ["accept", "accept-language", "content-type", "range"].forEach(function (k) {
      const v = req.headers.get(k); if (v) h.set(k, v);
    });
    h.set("user-agent", req.headers.get("user-agent") || "Mozilla/5.0");
    h.set("referer", t.origin + "/");
    if (req.method !== "GET" && req.method !== "HEAD") h.set("origin", t.origin);

    let up;
    const t0 = Date.now();
    try {
      up = await fetch(t.href, {
        method: req.method, headers: h, redirect: "manual",
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body
      });
    } catch (e) {
      sendLog(env, ctx, buildLog("error", t, 502, Date.now() - t0, 0, { reason: "upstream" }));
      return text(502, "Gagal menghubungi situs tujuan.");
    }

    if (up.status >= 300 && up.status < 400 && up.headers.get("location")) {
      let loc;
      try { loc = new URL(up.headers.get("location"), t.href); } catch (e) { return text(502, "Pengalihan tidak valid."); }
      if (blockedHost(loc.hostname)) return text(403, "Pengalihan ke alamat internal ditolak.");
      return new Response(null, { status: up.status, headers: { location: proxify(loc.href, t.href, url.origin), "x-robots-tag": "noindex" } });
    }

    const out = new Headers();
    ["content-type", "cache-control", "etag", "last-modified", "content-disposition", "content-range", "accept-ranges", "expires"].forEach(function (k) {
      const v = up.headers.get(k); if (v) out.set(k, v);
    });
    out.set("x-robots-tag", "noindex");
    out.set("referrer-policy", "same-origin");
    out.set("access-control-allow-origin", "*");

    const ct = (up.headers.get("content-type") || "").toLowerCase();
    const init = { status: up.status, headers: out };

    const dest = req.headers.get("sec-fetch-dest") || "";
    const isDoc = ct.indexOf("text/html") >= 0 || dest === "iframe" || dest === "document";
    const kind = up.status >= 400 ? "error" : isDoc ? "doc" : "asset";
    if (shouldLog(env, kind, up.status)) {
      sendLog(env, ctx, buildLog(kind, t, up.status, Date.now() - t0, parseInt(up.headers.get("content-length") || "0", 10) || 0));
    }

    if (ct.indexOf("text/html") >= 0) return rewriteHtml(up, init, t.href, url.origin);

    if (ct.indexOf("text/css") >= 0) {
      return new Response(rewriteCss(await up.text(), t.href, url.origin), init);
    }
    return new Response(up.body, init);
  }
};

function rewriteHtml(up, init, pageUrl, origin) {
  let base = pageUrl, injected = false;

  const attr = function (name) {
    return { element(el) {
      const v = el.getAttribute(name);
      if (v != null) el.setAttribute(name, proxify(v, base, origin));
    } };
  };

  let style = "";
  const rw = new HTMLRewriter()
    .on("head", { element(el) { injected = true; el.prepend(INJECT, { html: true }); } })
    .on("base", { element(el) {
      const v = el.getAttribute("href");
      if (v) { try { base = new URL(v, base).href; } catch (e) {} }
      el.remove();
    } })
    .on("meta", { element(el) {
      const eq = (el.getAttribute("http-equiv") || "").toLowerCase();
      if (eq === "content-security-policy" || (el.getAttribute("name") || "").toLowerCase() === "referrer") { el.remove(); return; }
      if (eq === "refresh") {
        const c = el.getAttribute("content") || "";
        el.setAttribute("content", c.replace(/(url\s*=\s*)(['"]?)([^'"]+)\2/i, function (m, a, q, u) { return a + q + proxify(u, base, origin) + q; }));
      }
    } })
    .on("[integrity]", { element(el) { el.removeAttribute("integrity"); } })
    .on("[referrerpolicy]", { element(el) { el.removeAttribute("referrerpolicy"); } })
    .on("a[target], form[target]", { element(el) {
      if (/^_(top|parent)$/i.test(el.getAttribute("target") || "")) el.setAttribute("target", "_self");
    } })
    .on("img[srcset], source[srcset]", { element(el) {
      el.setAttribute("srcset", rewriteSrcset(el.getAttribute("srcset"), base, origin));
    } })
    .on("style", { text(t) {
      style += t.text; t.remove();
      if (t.lastInTextNode) { t.replace(rewriteCss(style, base, origin), { html: true }); style = ""; }
    } });

  [["a", "href"], ["area", "href"], ["link", "href"], ["script", "src"], ["img", "src"], ["iframe", "src"],
   ["frame", "src"], ["source", "src"], ["video", "src"], ["video", "poster"], ["audio", "src"],
   ["track", "src"], ["embed", "src"], ["input", "src"], ["form", "action"], ["object", "data"]
  ].forEach(function (p) { rw.on(p[0] + "[" + p[1] + "]", attr(p[1])); });

  /* Halaman tanpa <head>: suntik di akhir dokumen */
  rw.onDocument({ end(end) { if (!injected) end.append(INJECT, { html: true }); } });

  return rw.transform(new Response(up.body, init));
}
