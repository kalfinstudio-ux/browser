# GoWithDME Browser

Halaman depan untuk **browser.gowithdme.com**: pilih browser dan alamat situs, lalu lihat layarnya dari server sesi. Situs statis tanpa build.

## Struktur
```
index.html        halaman
css/style.css     tampilan
js/config.js      pengaturan (API_URL, daftar browser, lama sesi)
js/api.js         komunikasi dengan server sesi
js/timer.js       hitung mundur
js/app.js         alur halaman
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
