/* Komunikasi dengan server sesi.
   POST   {API_URL}/sessions       body {browser, url}  -> {id, viewUrl, expiresAt (ms)}
   DELETE {API_URL}/sessions/{id}                       -> 204 */
(function (w) {
  var C = w.GWD_CONFIG;

  function request(path, opt) {
    if (!C.API_URL) {
      return Promise.reject(new Error("Server sesi belum diatur. Isi API_URL di js/config.js."));
    }
    return fetch(C.API_URL + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Server menolak permintaan (" + r.status + ").");
        return d;
      });
    });
  }

  w.GWD_API = {
    start: function (browser, url) {
      return request("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser: browser, url: url })
      });
    },
    stop: function (id) {
      return request("/sessions/" + encodeURIComponent(id), { method: "DELETE" }).catch(function () {});
    }
  };
})(window);
