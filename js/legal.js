/* Halaman legal: tombol aktif/nonaktif pencatatan (gwm_notrack, sama dengan js/track.js) dan tampilan kode perangkat. */
(function () {
  var st = document.getElementById("ntState"), btn = document.getElementById("ntBtn"), vid = document.getElementById("vidBox");
  var dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1";
  function manualOff() { try { return localStorage.getItem("gwm_notrack") === "1"; } catch (e) { return false; } }
  function paint() {
    var off = dnt || manualOff();
    st.textContent = dnt ? "Mati (Do Not Track aktif di browser Anda)" : off ? "Mati: tidak ada yang dicatat dari perangkat ini" : "Aktif: lalu lintas dicatat secara anonim";
    st.className = "state " + (off ? "off" : "on");
    btn.textContent = manualOff() ? "Nyalakan pencatatan" : "Matikan pencatatan";
    btn.disabled = dnt;
    try { vid.textContent = localStorage.getItem("gwd.vid") || "belum ada (belum pernah memakai browser, atau pencatatan mati)"; } catch (e) { vid.textContent = "tidak tersedia"; }
  }
  btn.addEventListener("click", function () {
    try { if (manualOff()) localStorage.removeItem("gwm_notrack"); else localStorage.setItem("gwm_notrack", "1"); }
    catch (e) { st.textContent = "Browser menolak menyimpan pengaturan ini."; return; }
    paint();
  });
  paint();
})();
