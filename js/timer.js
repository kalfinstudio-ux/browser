/* Hitung mundur sesi. */
(function (w) {
  function fmt(s) {
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }

  function Timer(textEl, boxEl, onEnd) {
    this.textEl = textEl; this.boxEl = boxEl; this.onEnd = onEnd; this.id = null;
  }

  Timer.prototype.start = function (endsAt) {
    var self = this;
    this.stop();
    function tick() {
      var left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      self.textEl.textContent = fmt(left) + " tersisa";
      self.boxEl.classList.toggle("warn", left <= 60);
      if (left <= 0) { self.stop(); self.onEnd(); }
    }
    tick();
    this.id = setInterval(tick, 1000);
  };

  Timer.prototype.stop = function () {
    clearInterval(this.id);
    this.id = null;
    this.boxEl.classList.remove("warn");
  };

  w.GWD_Timer = Timer;
})(window);
