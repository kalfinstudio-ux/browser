/* Pengaturan situs. Ubah di sini saja, tidak perlu menyentuh file lain. */
window.GWD_CONFIG = {
  /* Alamat server sesi (VPS), tanpa garis miring di akhir. Contoh: "https://sesi.gowithdme.com/api".
     Selama kosong, tombol Mulai sesi menampilkan pesan bahwa server belum diatur. */
  API_URL: "",

  /* Alamat Worker proxy (lihat worker/proxy.js), tanpa garis miring di akhir.
     Contoh: "https://gowithdme-proxy.akunmu.workers.dev". Pakai domain terpisah dari gowithdme.com. */
  PROXY_URL: "",

  /* Mesin pencari untuk kata kunci yang bukan alamat situs */
  SEARCH_URL: "https://html.duckduckgo.com/html/?q=",

  /* Lama sesi (menit). Server tetap yang menentukan; angka ini hanya tampilan awal. */
  SESSION_MINUTES: 5,

  DEFAULT_URL: "gowithdme.com",

  OS: [
    { id: "linux", label: "Linux", enabled: true },
    { id: "win10", label: "Windows 10 (segera)", enabled: false }
  ],

  BROWSERS: [
    { id: "chrome", label: "Chrome" },
    { id: "firefox", label: "Firefox" },
    { id: "edge", label: "Edge" }
  ]
};
