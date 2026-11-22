# GoWithDME Browser

Halaman depan untuk **browser.gowithdme.com**: pilih browser dan alamat situs, lalu lihat layarnya dari server sesi. Situs statis tanpa build.

## Struktur
```
index.html        halaman browser (tab, bar alamat, bookmark, riwayat, ukuran layar)
css/style.css     tampilan dasar
css/browser.css   tampilan browser
js/browser.js     logika browser
js/config.js      pengaturan (PROXY_URL, mesin pencari, API_URL)
worker/proxy.js   proxy Cloudflare Worker agar situs yang memblokir iframe tetap terbuka
worker/wrangler.toml
js/api.js, js/timer.js, js/app.js   versi lama (sesi server), tidak dipakai index.html
CNAME             browser.gowithdme.com
```

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
