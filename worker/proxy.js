/* Proxy pembuka situs untuk iframe (Cloudflare Worker).
   Alamat:  https://<worker>/p/https://contoh.com/halaman?x=1
   - Menghapus X-Frame-Options dan Content-Security-Policy dari situs tujuan.
   - Menulis ulang tautan, gambar, skrip, CSS, dan form di HTML agar tetap lewat proxy.
   - Menyuntik skrip kecil untuk fetch/XHR/window.open dan melaporkan alamat halaman ke induk.
   - Tidak meneruskan cookie (tidak ada login lewat proxy).
   - Hanya melayani permintaan dari ALLOWED_ORIGINS, menolak alamat jaringan internal.
   - Moderasi: daftar blokir/peringatan host dari Supabase (browser_blocklist_get, cache ~60 detik) dan
     batas pemakaian per alamat IP (binding RL_DOC / RL_ALL; IP hanya dipakai sementara, tidak disimpan atau dicatat). */

const PREFIX = "/p/";
const PREFIX_ACK = "/q/";   /* sama panjang dengan PREFIX: halaman yang sudah dikonfirmasi pengguna lewat peringatan */

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
    if (u.origin === origin && (u.pathname.indexOf(PREFIX) === 0 || u.pathname.indexOf(PREFIX_ACK) === 0)) return u.href;
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
export const INJECT = "<script>(function(){" +
  "var O=location.origin;" +
  "function real(){return (location.pathname.slice(3)+location.search).replace(/^(https?):\\/+/i,'$1://')}" +
  "function px(u){try{var s=String(u);if(!s||/^(#|data:|blob:|javascript:|mailto:|tel:|about:)/i.test(s))return u;" +
  "var a=new URL(s,real());if(a.protocol!=='http:'&&a.protocol!=='https:')return u;" +
  "if(a.origin===O&&(a.pathname.indexOf('/p/')===0||a.pathname.indexOf('/q/')===0))return a.href;return O+'/p/'+a.href}catch(e){return u}}" +
  "try{var F=window.fetch;if(F)window.fetch=function(i,o){try{if(typeof i==='string'||i instanceof URL)i=px(i);" +
  "else if(i&&i.url){var n=px(i.url);if(n!==i.url)i=new Request(n,i)}}catch(e){}return F.call(this,i,o)}}catch(e){}" +
  "try{var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=px(u);return X.apply(this,arguments)}}catch(e){}" +
  /* Tab/jendela baru dari situs diteruskan ke browser induk supaya dibuka sebagai tab di dalam aplikasi, bukan tab browser asli.
     Hanya bila ada interaksi pengguna (klik), agar iklan pop-up otomatis tidak membanjiri tab. */
  "function unp(h){try{var a=new URL(h,location.href);if(a.origin===O&&/^\\/[pq]\\//.test(a.pathname))return (a.pathname.slice(3)+a.search+a.hash).replace(/^(https?):\\/+/i,'$1://');return a.href}catch(e){return ''}}" +
  "function opn(u){try{if(navigator.userActivation&&!navigator.userActivation.isActive)return false;u=unp(u);if(!/^https?:/i.test(u))return false;parent.postMessage({gwdProxy:1,open:u},'*');return true}catch(e){return false}}" +
  /* Pemblokir overlay tak terlihat / pop-up dari sentuhan.
     Setiap sentuhan dicatat (elemen yang disentuh, apakah ia lapisan transparan, apakah di atas video).
     Bila sesaat sesudahnya halaman membuka tab baru (window.open, a.click() ber-target), pop-up ditolak jika:
       - yang disentuh lapisan tak terlihat (opacity ~0, atau kotak kosong transparan melayang yang luas), atau iframe iklan tak terlihat;
       - atau yang disentuh bukan kontrol (bukan tautan/tombol/input) dan tujuannya situs lain;
       - atau sentuhan jatuh di area <video> (geser maju, percepat, ketuk layar) dan tujuannya situs lain.
     Lapisan yang ketahuan diberi pointer-events:none agar sentuhan berikutnya menembus ke video. Pemanggil dapat objek jendela palsu
     (bukan null) supaya skrip iklan tidak beralih ke location.href. */
  "var G={t:0,ghost:null,ui:false,v:false},BT=0,FE=null;try{FE=window.frameElement}catch(e){}" +
  "function al(c){var m=String(c).match(/rgba?\\(([^)]+)\\)/);if(!m)return c==='transparent'?0:1;var p=m[1].split(/[ ,\\/]+/).filter(Boolean);return p.length>3?parseFloat(p[3])*(/%/.test(p[3])?0.01:1):1}" +
  "function gb(el,only){try{var w=el.ownerDocument.defaultView||window,cs=w.getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')return false;" +
  "var r=el.getBoundingClientRect();if(r.width*r.height<(w.innerWidth||1)*(w.innerHeight||1)*0.04)return false;" +
  "if(/^(VIDEO|CANVAS|IMG|SVG|PICTURE|BUTTON|INPUT|TEXTAREA|SELECT|AUDIO|BODY|HTML)$/i.test(el.tagName))return false;" +
  "var op=1,n=el;for(var i=0;n&&n.nodeType===1&&i<6;i++,n=n.parentElement){var o=parseFloat(w.getComputedStyle(n).opacity);op*=isNaN(o)?1:o}" +
  "if(op<0.05)return true;if(only)return false;" +
  "if(al(cs.backgroundColor)>0.05||cs.backgroundImage!=='none')return false;" +
  "if((el.textContent||'').replace(/\\s/g,''))return false;" +
  "if(el.querySelector&&el.querySelector('img,video,canvas,svg,button,input,picture,audio'))return false;" +
  "return cs.position==='fixed'||cs.position==='absolute'||cs.position==='sticky'||parseInt(cs.zIndex,10)>0}catch(e){return false}}" +
  "function fg(t){var n=t,d=0;while(n&&n.nodeType===1&&d<6&&n!==document.body&&n!==document.documentElement){if(gb(n))return n;n=n.parentElement;d++}return FE&&gb(FE,1)?FE:null}" +
  "function ui(t){return !!(t&&t.closest&&t.closest('a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=slider]'))}" +
  "function pv(e){try{var q=(e.changedTouches&&e.changedTouches[0])||e,x=q.clientX,y=q.clientY,vs=document.getElementsByTagName('video');" +
  "for(var i=0;i<vs.length;i++){var r=vs[i].getBoundingClientRect();if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return true}}catch(x){}return false}" +
  "function tap(e){try{var t=(e.composedPath&&e.composedPath()[0])||e.target;if(t&&t.nodeType!==1)t=t.parentElement;G.t=Date.now();G.ghost=t?fg(t):null;G.ui=ui(t);G.v=pv(e)}catch(x){}}" +
  "['pointerdown','touchstart','mousedown','pointerup','touchend','mouseup','click'].forEach(function(n){addEventListener(n,tap,true)});" +
  "function same(h,m){return !h||h===m||h.slice(-m.length-1)==='.'+m||m.slice(-h.length-1)==='.'+h}" +
  "function bad(u){try{var n=Date.now();if(n-BT<1500)return true;if(n-G.t>2500)return false;if(G.ghost)return true;" +
  "if(!u)return !G.ui||G.v;var m=new URL(real()).hostname,h=new URL(unp(u)||u,real()).hostname;return (!G.ui||G.v)&&!same(h,m)}catch(e){return false}}" +
  "function blk(u){try{BT=Date.now();if(G.ghost)G.ghost.style.setProperty('pointer-events','none','important');var h='';try{h=new URL(unp(u||'')||u||'',real()).hostname}catch(e){}top.postMessage({gwdProxy:1,blocked:h||'-'},'*')}catch(e){}}" +
  "function fake(){var d={write:function(){},writeln:function(){},close:function(){}};d.open=function(){return d};return {closed:false,close:function(){this.closed=true},focus:function(){},blur:function(){},postMessage:function(){},document:d,location:{href:'',assign:function(){},replace:function(){}}}}" +
  "try{var W=window.open;window.open=function(u,n,f){var g=String(n||'_blank').toLowerCase(),out=g!=='_self'&&g!=='_top'&&g!=='_parent';" +
  "if(out&&bad(u)){blk(u);return fake()}if(u&&out){opn(px(u));return null}if(u)arguments[0]=px(u);return W.apply(this,arguments)}}catch(e){}" +
  "try{var AC=HTMLElement.prototype.click;HTMLAnchorElement.prototype.click=function(){try{var g=(this.getAttribute('target')||'').toLowerCase();if(g&&g!=='_self'&&g!=='_top'&&g!=='_parent'&&bad(this.href)){blk(this.href);return}}catch(e){}return AC.apply(this,arguments)}}catch(e){}" +
  "addEventListener('click',function(e){try{if(e.defaultPrevented||e.button>1)return;var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;" +
  "if(G.ghost&&Date.now()-G.t<2500){e.preventDefault();e.stopImmediatePropagation();blk(a.href);return}var g=(a.getAttribute('target')||'').toLowerCase();" +
  "if(g==='_top'||g==='_parent'){e.preventDefault();location.href=a.href;return}" +
  "if((g&&g!=='_self')||e.ctrlKey||e.metaKey||e.shiftKey){if(!/^https?:/i.test(unp(a.href)))return;e.preventDefault();opn(a.href)}}catch(x){}},true);" +
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
  /* Laporan scroll ke browser induk (untuk menyembunyikan header): selisih posisi per frame; top=true bila dokumen di paling atas. */
  "try{var LP=new WeakMap(),sq=0,sd=0,st=false;addEventListener('scroll',function(e){var t=e.target,doc=(t===document||t===window),el=doc?(document.scrollingElement||document.documentElement):t;" +
  "if(!el||typeof el.scrollTop!=='number')return;var y=el.scrollTop,p=LP.get(el);LP.set(el,y);if(p==null)return;sd+=y-p;if(doc)st=y<=2;" +
  "if(!sq){sq=1;requestAnimationFrame(function(){sq=0;var d=sd;sd=0;try{parent.postMessage({gwdProxy:1,sc:d,top:st},'*')}catch(x){}})}},true)}catch(e){}" +
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

/* ---------- moderasi: aturan blokir/peringatan dan batas pemakaian ---------- */

/* "a.b.contoh.com" -> ["a.b.contoh.com", "b.contoh.com", "contoh.com"]; subdomain ikut tercakup aturan induknya. */
export function hostCandidates(h) {
  h = String(h || "").toLowerCase().replace(/^www\./, "");
  const p = h.split("."), out = [];
  for (let i = 0; i <= p.length - 2; i++) out.push(p.slice(i).join("."));
  return out;
}

/* map: Map(host -> {host, action, reason}). Aturan "block" menang atas "warn". */
export function matchRule(map, hostname) {
  if (!map || !map.size) return null;
  let found = null;
  const c = hostCandidates(hostname);
  for (let i = 0; i < c.length; i++) {
    const r = map.get(c[i]);
    if (r) { if (r.action === "block") return r; if (!found) found = r; }
  }
  return found;
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function num(v, d) { const x = parseInt(v, 10); return x > 0 ? x : d; }

/* Aturan disimpan di memori Worker ~60 detik. Bila Supabase tidak bisa dihubungi, aturan lama tetap dipakai;
   bila belum pernah berhasil dimuat, permintaan tetap dilayani (fail-open) supaya proxy tidak mati karena database. */
let RULES = { at: 0, map: null, fail: 0, p: null };

async function loadRules(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.LOG_SECRET) return null;
  const now = Date.now();
  if (RULES.map && now - RULES.at < 60000) return RULES.map;
  if (RULES.p) return RULES.p;
  if (!RULES.map && RULES.fail && now - RULES.fail < 10000) return null;
  RULES.p = (async function () {
    try {
      const r = await fetch(String(env.SUPABASE_URL).replace(/\/+$/, "") + "/rest/v1/rpc/browser_blocklist_get", {
        method: "POST",
        headers: { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY },
        body: JSON.stringify({ p_secret: env.LOG_SECRET }),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
      });
      if (r.ok) {
        const rows = await r.json(), m = new Map();
        if (Array.isArray(rows)) rows.forEach(function (x) { if (x && x.host) m.set(String(x.host).toLowerCase(), x); });
        RULES.map = m; RULES.at = Date.now(); RULES.fail = 0;
        return m;
      }
    } catch (e) {}
    RULES.fail = Date.now();
    if (RULES.map) RULES.at = Date.now() - 45000;   /* pakai aturan lama, coba lagi ~15 detik */
    return RULES.map;
  })();
  try { return await RULES.p; } finally { RULES.p = null; }
}

/* Batas pemakaian. Memakai binding Cloudflare Rate Limiting bila ada (lihat wrangler.toml);
   bila tidak, cadangan sederhana di memori isolate (kurang akurat, tetap membantu). Kunci = IP, tidak disimpan. */
const MEM = new Map();
async function overLimit(env, name, key, perMin) {
  const b = env[name];
  if (b && typeof b.limit === "function") {
    try { const r = await b.limit({ key: key }); return !r.success; } catch (e) { return false; }
  }
  const now = Date.now(), k = name + ":" + key, w = MEM.get(k);
  if (!w || now - w.t > 60000) { if (MEM.size > 5000) MEM.clear(); MEM.set(k, { t: now, n: 1 }); return false; }
  w.n++;
  return w.n > perMin;
}

const PAGE_CSS = "body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f5;color:#1b2420;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}" +
  "main{max-width:440px;background:#fff;border:1px solid #dfe3df;border-radius:12px;padding:22px}h1{font-size:1.2rem;margin:0 0 8px}p{margin:8px 0;color:#5f6b65}b{color:#1b2420;word-break:break-all}" +
  "button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid #dfe3df;background:#fff;color:#1b2420;cursor:pointer;margin:8px 8px 0 0}button.go{background:#e8561a;border-color:#e8561a;color:#fff}" +
  "@media(prefers-color-scheme:dark){body{background:#0e1311;color:#e8eeea}main{background:#161c19;border-color:#2a332f}p{color:#9aa7a0}b{color:#e8eeea}button{background:#1d2521;border-color:#2a332f;color:#e8eeea}button.go{background:#ff7a3d;border-color:#ff7a3d;color:#0e1311}}";

function htmlPage(status, body, script, extraHeaders) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'" + (script ? "; script-src 'unsafe-inline'" : "") + "; base-uri 'none'; form-action 'none'";
  const h = Object.assign({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "content-security-policy": csp }, extraHeaders || {});
  return new Response('<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GoWithDME</title><style>' +
    PAGE_CSS + "</style></head><body><main>" + body + "</main>" + (script ? "<script>" + script + "</script>" : "") + "</body></html>", { status: status, headers: h });
}

export function blockedPage(host, reason) {
  return htmlPage(403, "<h1>Situs ini diblokir</h1><p><b>" + esc(host) + "</b> tidak bisa dibuka lewat Browser GoWithDME." +
    (reason ? "</p><p>Alasan: " + esc(reason) : "") + "</p><p>Merasa ini keliru? Hubungi admin@gowithdme.com.</p>");
}

export function tooManyPage() {
  return htmlPage(429, "<h1>Terlalu banyak permintaan</h1><p>Tunggu sekitar satu menit, lalu muat ulang halaman ini.</p>", null, { "retry-after": "60" });
}

/* Halaman peringatan: setelah "Lanjutkan", pilihan diingat selama sesi tab (sessionStorage) agar tidak ditanya tiap halaman. */
export function warnPage(ruleHost, shownHost, reason, goPath) {
  const body = "<h1>Situs ini ditandai bermasalah</h1><p><b>" + esc(shownHost) + "</b></p>" +
    "<p>" + (reason ? esc(reason) : "Situs ini pernah dilaporkan berbahaya atau menyesatkan.") + "</p>" +
    "<p>Jangan memasukkan kata sandi, data pribadi, atau data pembayaran di sini.</p>" +
    '<button class="go" id="go" type="button" data-href="' + esc(goPath) + '" data-key="' + esc("gwd.ack." + ruleHost) + '">Lanjutkan</button>' +
    '<button id="back" type="button">Kembali</button>';
  const script = "(function(){var g=document.getElementById('go'),h=g.getAttribute('data-href'),k=g.getAttribute('data-key');" +
    "try{if(sessionStorage.getItem(k)==='1'){location.replace(h);return}}catch(e){}" +
    "g.onclick=function(){try{sessionStorage.setItem(k,'1')}catch(e){}location.replace(h)};" +
    "document.getElementById('back').onclick=function(){if(history.length>1)history.back();else document.body.textContent=''}})();";
  return htmlPage(200, body, script);
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

    let target, acked = false;
    if (url.pathname.indexOf(PREFIX) === 0 || url.pathname.indexOf(PREFIX_ACK) === 0) {
      acked = url.pathname.indexOf(PREFIX_ACK) === 0;
      target = targetFromPath(url.pathname, url.search);
    } else {
      /* Alamat "/foo" dari skrip halaman: cari asalnya lewat Referer */
      const ref = req.headers.get("referer");
      try {
        const r = new URL(ref);
        if (r.origin !== url.origin || (r.pathname.indexOf(PREFIX) !== 0 && r.pathname.indexOf(PREFIX_ACK) !== 0)) return text(404, "Tidak ditemukan.");
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

    /* Moderasi: batas pemakaian, lalu daftar blokir/peringatan. */
    const fdest = req.headers.get("sec-fetch-dest") || "";
    const wantsDoc = fdest === "iframe" || fdest === "document" || (req.headers.get("accept") || "").indexOf("text/html") >= 0;
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    if ((await overLimit(env, "RL_ALL", ip, num(env.LIMIT_ALL_PER_MIN, 900))) ||
        (wantsDoc && (await overLimit(env, "RL_DOC", ip, num(env.LIMIT_DOC_PER_MIN, 60))))) {
      if (Math.random() < 0.1) sendLog(env, ctx, buildLog("error", t, 429, 0, 0, { type: "limited", scope: wantsDoc ? "doc" : "all" }));
      return wantsDoc ? tooManyPage() : text(429, "Terlalu banyak permintaan. Coba lagi sebentar.");
    }
    const rule = matchRule(await loadRules(env), t.hostname);
    if (rule && rule.action === "block") {
      sendLog(env, ctx, buildLog("error", t, 403, 0, 0, { type: "blocked" }));
      return wantsDoc ? blockedPage(t.hostname, rule.reason) : text(403, "Situs ini diblokir.");
    }
    if (rule && rule.action === "warn" && wantsDoc && !acked) {
      sendLog(env, ctx, buildLog("doc", t, 200, 0, 0, { type: "warned" }));
      return warnPage(rule.host, t.hostname, rule.reason, PREFIX_ACK + t.href);
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
