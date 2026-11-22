/* Alur halaman: isi pilihan, mulai sesi, tampilkan layar, akhiri sesi. */
(function () {
  var C = window.GWD_CONFIG, API = window.GWD_API;
  var $ = function (id) { return document.getElementById(id); };
  var form = $("sessionForm"), osSel = $("os"), brSel = $("browser"), urlIn = $("url"),
      startBtn = $("startBtn"), endBtn = $("endBtn"), msg = $("msg"),
      stage = $("stage"), empty = $("empty"), timerText = $("timerText");
  var current = null, frame = null;

  var timer = new window.GWD_Timer(timerText, $("timerBox"), function () { endSession("Waktu sesi habis."); });

  function fill(sel, items) {
    sel.innerHTML = items.map(function (i) {
      return '<option value="' + i.id + '"' + (i.enabled === false ? " disabled" : "") + ">" + i.label + "</option>";
    }).join("");
  }

  function say(text) { msg.textContent = text || ""; msg.hidden = !text; }

  /* Terima "gowithdme.com" atau alamat lengkap; hanya http/https. */
  function normalizeUrl(v) {
    v = (v || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try {
      var u = new URL(v);
      return /^https?:$/.test(u.protocol) && u.hostname.indexOf(".") > 0 ? u.href : "";
    } catch (e) { return ""; }
  }

  function setBusy(on) {
    startBtn.disabled = on;
    startBtn.textContent = on ? "Menyiapkan sesi…" : "Mulai sesi";
  }

  function showSession(viewUrl) {
    frame = document.createElement("iframe");
    frame.title = "Layar browser";
    frame.src = viewUrl;
    frame.allow = "clipboard-read; clipboard-write; fullscreen; autoplay";
    frame.referrerPolicy = "no-referrer";
    empty.hidden = true;
    stage.appendChild(frame);
    startBtn.hidden = true; endBtn.hidden = false;
    [osSel, brSel, urlIn].forEach(function (e) { e.disabled = true; });
  }

  function endSession(note) {
    timer.stop();
    if (current) API.stop(current.id);
    current = null;
    if (frame) { frame.remove(); frame = null; }
    empty.hidden = false;
    startBtn.hidden = false; endBtn.hidden = true;
    [osSel, brSel, urlIn].forEach(function (e) { e.disabled = false; });
    timerText.innerHTML = "Sesi singkat, maksimal <b>" + C.SESSION_MINUTES + "</b> menit.";
    say(note || "");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    say("");
    var url = normalizeUrl(urlIn.value);
    if (!url) return say("Alamat situs tidak valid. Contoh: gowithdme.com");
    setBusy(true);
    API.start(brSel.value, url).then(function (s) {
      current = s;
      showSession(s.viewUrl);
      timer.start(s.expiresAt);
    }).catch(function (err) {
      say(err.message);
    }).then(function () { setBusy(false); });
  });

  endBtn.addEventListener("click", function () { endSession(""); });
  window.addEventListener("pagehide", function () { if (current) API.stop(current.id); });

  fill(osSel, C.OS);
  fill(brSel, C.BROWSERS);
  urlIn.value = C.DEFAULT_URL;
  $("maxMin").textContent = C.SESSION_MINUTES;
})();
