# GoWithDME Browser

Halaman depan untuk **browser.gowithdme.com**: pilih browser dan alamat situs, lalu lihat layarnya dari server sesi. Situs statis tanpa build.

## Struktur
```
index.html        halaman browser (tab, bar alamat, bookmark, riwayat, ukuran layar)
css/style.css     tampilan dasar (juga dipakai legal.html)
css/browser.css   tampilan browser (tab, toolbar, bar alamat, menu, responsif)
js/browser.js     logika browser
js/config.js      pengaturan (PROXY_URL, mesin pencari, API_URL, SUPABASE_URL/ANON_KEY)
js/track.js       pencatat lalu lintas ke Supabase (tampil di Panel Admin)
supabase/schema_browser.sql  tabel + fungsi Supabase untuk lalu lintas
worker/proxy.js   proxy Cloudflare Worker agar situs yang memblokir iframe tetap terbuka
worker/wrangler.toml
js/api.js, js/timer.js, js/app.js   versi lama (sesi server), tidak dipakai index.html
CNAME             browser.gowithdme.com
```

## Fitur browser
- Tab (maks. 8) yang diingat saat halaman dibuka lagi (dimuat saat tabnya dibuka). Bisa dimatikan di menu > "Ingat tab saat dibuka lagi".
- Bar alamat dengan ikon kunci, lencana Proxy/Langsung, bintang bookmark, dan saran dari bookmark + riwayat (panah atas/bawah, Enter).
- Tombol muat ulang berubah menjadi Hentikan saat halaman dimuat.
- Pintasan: `Ctrl/Cmd+L` fokus ke alamat, `Alt+T` tab baru, `Alt+W` tutup tab, `Alt+←/→` mundur/maju, `Esc` tutup menu/keluar mode fokus. Di daftar tab: panah kiri/kanan, `Delete`, klik tengah untuk menutup.
- Pemberitahuan dan indikator muat dipisah per tab; alamat dari proxy divalidasi (hanya http/https); pesan offline/online.

## Pasang di GitHub Pages
1. Buat repo baru (mis. `gowithdme-browser`), unggah seluruh isi folder ke root.
2. Settings > Pages > Deploy from a branch > `main` / root. Centang Enforce HTTPS.
3. DNS: rekor CNAME `browser` mengarah ke `<akun-github>.github.io`.

## Hubungkan ke server sesi
Isi `API_URL` di `js/config.js` (wajib `https://`). Kontrak yang dipakai halaman ini:

- `POST {API_URL}/sessions` dengan `{"browser":"chrome","url":"https://..."}` membalas `{"id","viewUrl","expiresAt"}` (`expiresAt` dalam milidetik epoch).
- `DELETE {API_URL}/sessions/{id}` mengakhiri sesi.

Server harus mengizinkan CORS dari `https://browser.gowithdme.com`, membatasi sesi per IP, memblokir alamat jaringan internal, dan menghapus container saat sesi habis.


## Proxy agar bisa membuka situs apa saja
Banyak situs melarang tampil di iframe (`X-Frame-Options`, CSP). Proxy di `worker/` mengambil halamannya di server, menghapus larangan itu, dan menulis ulang tautan agar tetap lewat proxy.

1. `cd worker && npx wrangler deploy` (akun Cloudflare gratis cukup).
2. Pastikan `ALLOWED_ORIGINS` di `wrangler.toml` berisi `https://browser.gowithdme.com`.
3. Isi `PROXY_URL` di `js/config.js` dengan alamat Worker (mis. `https://gowithdme-proxy.akunmu.workers.dev`).

Penting: pakai domain `workers.dev` atau domain lain di luar `gowithdme.com`. Bila proxy ada di subdomain `gowithdme.com`, skrip dari situs yang diproxy bisa menyetel cookie untuk seluruh domain.

Batasan: tidak ada login (cookie tidak diteruskan), situs yang sangat bergantung JavaScript atau WebSocket bisa rusak sebagian, dan sebagian situs memblokir alamat server Cloudflare. Untuk situs seperti itu tombol "Buka di tab baru" tetap tersedia. Untuk benar-benar semua situs diperlukan browser jarak jauh di server (rancangan `js/api.js`).


## Lalu lintas ke Panel Admin (Supabase)
Setiap kunjungan, situs yang dibuka, pencarian, situs bermasalah, dan lalu lintas proxy dicatat ke Supabase lalu tampil di **admin.gowithdme.com > Statistik > Browser** (hanya akun dengan izin `stats.view`).

Pasang berurutan:
1. Supabase > SQL Editor: jalankan `supabase/schema_browser.sql` (setelah `schema_rbac.sql`). Aman diulang.
2. Ambil rahasia Worker: `select value from browser_settings where key='proxy_secret';`
3. Worker: `cd worker && npx wrangler secret put LOG_SECRET` (tempel nilai tadi), lalu `npx wrangler deploy`. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LOG_ASSET_SAMPLE` ada di `wrangler.toml`.
4. Unggah situs ini (`js/track.js` dan `js/config.js` sudah terisi).
5. Admin: unggah repo admin yang baru (`js/admin-stats.js`, `index.html`).

Yang dicatat: jenis aksi, nama situs, path tanpa query/hash, mode (proxy/langsung), status HTTP, waktu muat, ukuran data, ukuran layar, dan kode acak per browser. Tidak dicatat: IP, cookie, kata pencarian, isi halaman. Mati otomatis bila Do Not Track aktif. Perbarui Kebijakan Privasi agar menyebut pencatatan ini.

Keamanan: tabel tertutup untuk klien (RLS tanpa policy). Penulisan hanya lewat `browser_log()` yang membatasi jenis peristiwa, panjang teks, 25 peristiwa per panggilan, dan 150 per menit per kunjungan. Peristiwa dari proxy hanya diterima bila membawa `LOG_SECRET`. Data lama dibersihkan dari panel (pemilik) atau lewat pg_cron (lihat akhir file SQL).


## Moderasi: daftar blokir, peringatan, laporan, batas pemakaian
Pemilik mengelola di **admin.gowithdme.com > Statistik > Moderasi**.

- **Daftar blokir/peringatan** (`browser_blocklist`): host (subdomain ikut tercakup). Worker memuatnya dari Supabase tiap ~60 detik (`browser_blocklist_get`, butuh `LOG_SECRET`). `block` menampilkan halaman blokir; `warn` menampilkan halaman peringatan, pilihan "Lanjutkan" diingat selama sesi tab (alamat `/q/` = sudah dikonfirmasi). Bila Supabase tidak terjangkau, aturan terakhir tetap dipakai; bila belum pernah termuat, proxy tetap melayani (fail-open).
- **Mode Langsung tidak bisa ditegakkan** (situs dibuka langsung oleh browser pengguna). `js/moderasi.js` hanya mencegah di halaman ini dan bisa dilewati. Untuk penegakan penuh, paksa mode Proxy.
- **Laporan pengguna**: menu browser > "Laporkan situs ini" (`browser_report`, dibatasi 5 per 10 menit per kunjungan dan 300 per jam global). Panel admin menampilkan per situs dengan tombol Blokir / Beri peringatan / Abaikan.
- **Batas pemakaian**: binding Cloudflare Rate Limiting `RL_DOC` (halaman, 60/menit) dan `RL_ALL` (semua permintaan, 900/menit) per IP per lokasi, diatur di `worker/wrangler.toml`. Tanpa binding, Worker memakai penghitung cadangan di memori. IP hanya dipakai sementara, tidak disimpan atau dicatat. Butuh Wrangler 4.36+: `npx wrangler@latest deploy`.

Pasang berurutan: (1) Supabase SQL Editor: jalankan `supabase/schema_moderasi.sql` (setelah `schema_browser.sql`); (2) `cd worker && npx wrangler@latest deploy`; (3) unggah situs ini; (4) unggah repo admin yang baru (`js/admin-moderasi.js`, `js/admin-stats.js`, `index.html`).

Peristiwa moderasi tercatat sebagai peristiwa proxy dengan `meta.type` = `blocked` | `warned` | `limited` (status 403/200/429). Penolakan ikut terhitung di statistik "galat" proxy; `limited` dicatat 10% saja agar banjir permintaan tidak membengkakkan tabel.

## Aktivitas per kunjungan (SQL)
`supabase/schema_browser_activity.sql` menambah `admin_browser_sessions()` (daftar kunjungan) dan `admin_browser_session(sid)` (linimasa satu kunjungan, dicatat di log audit). Belum ada tampilannya di panel; panggil lewat SQL Editor atau `sb.rpc(...)`.

## Halaman legal
`legal.html` memuat Syarat, Penggunaan terlarang, Kebijakan Privasi, Mode proxy, Pengaturan pelacakan (tombol matikan pencatatan dan kode perangkat), Hak cipta, dan Kontak. Footer di `index.html` menautkannya. Ikon: `assets/` (sama dengan repo admin).
