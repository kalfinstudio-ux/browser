/* Pengaturan situs. Ubah di sini saja, tidak perlu menyentuh file lain. */
window.GWD_CONFIG = {
  /* Alamat server sesi (VPS), tanpa garis miring di akhir. Contoh: "https://sesi.gowithdme.com/api".
     Selama kosong, tombol Mulai sesi menampilkan pesan bahwa server belum diatur. */
  API_URL: "",

  /* Alamat Worker proxy (lihat worker/proxy.js), tanpa garis miring di akhir.
     Contoh: "https://gowithdme-proxy.akunmu.workers.dev". Pakai domain terpisah dari gowithdme.com. */
  PROXY_URL: "https://gowithdme-proxy.calvfinka.workers.dev",

  /* Supabase untuk mencatat lalu lintas -> tampil di Panel Admin > Statistik > Browser.
     Sama dengan js/config.js di repo admin. Kunci publishable memang publik; keamanan ada di fungsi browser_log (supabase/schema_browser.sql).
     Kosongkan salah satunya untuk mematikan pencatatan. */
  SUPABASE_URL: "https://jhqkylnqvhrljpaknjcg.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_WEpourxfk4IKga2XyxKucQ_hkmxuJnY",

  /* Mesin pencari untuk kata kunci yang bukan alamat situs */
  SEARCH_URL: "https://html.duckduckgo.com/html/?q=",

  /* Lama sesi (menit). Server tetap yang menentukan; angka ini hanya tampilan awal. */
  SESSION_MINUTES: 5,

  /* Alamat publik situs ini (dipakai untuk tautan "Bagikan"), dengan garis miring di akhir. */
  SITE_URL: "https://browser.gowithdme.com/",

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
