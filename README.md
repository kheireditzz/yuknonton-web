# 🎬 YukNonton

> Platform streaming film & serial viral dengan desain **tactile neumorphism** — katalog realtime, pencarian, rating, komentar, dan pemutar HLS/MP4 adaptif.

<p align="center">
  <img src="public/img/icon-512.png" width="140" alt="YukNonton">
</p>

<p align="center">
  <a href="https://yuknonton.kheireditz.my.id"><b>🌐 Live Demo</b></a> ·
  <a href="#-fitur">Fitur</a> ·
  <a href="#-arsitektur">Arsitektur</a> ·
  <a href="#-api">API</a> ·
  <a href="#-deploy">Deploy</a>
</p>

---

## ✨ Fitur

- **31 kategori katalog** — Trending, Serial Hari Ini, Anime, Donghua, Drama (China/Jepang/Korea), Film, genre (Aksi, Horor, Thriller, Fantasi, Keluarga, Dokumenter, dll).
- **Realtime-aware** — kategori bertanda `realtime` auto-refresh dengan TTL pendek + polling berkala di frontend.
- **Pagination** — tombol "Muat Lagi" dengan dedupe otomatis per kategori.
- **Pencarian** — query langsung ke sumber, hasil dengan poster & rating.
- **Detail lengkap** — sinopsis, genre, rating, durasi, network, IMDb, prediksi skor.
- **Episode picker** — pilih musim & episode untuk serial.
- **Pemutar pintar** — HLS.js + fallback native, pemilih kualitas, proxy HLS internal (bypass CORS/referer).
- **Mini player** — tonton sambil menelusuri katalog.
- **Interaksi sosial** — like/dislike, komentar, dan rating poll 1–5 bintang dengan persistensi JSON.
- **PWA-ready** — manifest, ikon maskable, theme color.

## 🧱 Arsitektur

```
yuknonton-web/
├── server.js                 # HTTP server murni (static + routing) & entry Vercel
├── api/index.js              # Adapter serverless untuk Vercel
├── src/
│   ├── config/constants.js   # 31 definisi kategori, TTL, header scraper
│   ├── routes/
│   │   ├── api.routes.js     # Router REST API
│   │   └── hls.proxy.js      # Proxy m3u8/segment + rewrite playlist
│   ├── services/
│   │   ├── tmdb.service.js       # Scraper katalog/detail/season/episode
│   │   ├── catalog.service.js    # Katalog + cache per-kategori
│   │   ├── vidlink.service.js    # Resolver stream (WASM token)
│   │   ├── cache.service.js      # In-memory TTL cache
│   │   └── interactions.service.js  # Komentar/like/rating (persist JSON)
│   └── scraper/              # Bootstrap + modul WASM resolver
└── public/                   # Frontend statis (HTML/CSS/JS), tanpa framework
```

- **Backend**: Node.js ESM tanpa dependency web framework — `node:http` murni.
- **Frontend**: vanilla JS + CSS neumorphism (tanpa build step).
- **Stream resolver**: modul WebAssembly + `libsodium-wrappers` untuk pembuatan token.

## 🔌 API

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| `GET` | `/api/categories` | Daftar 31 kategori |
| `GET` | `/api/catalog?cat=<id>&page=<n>` | Kartu katalog per kategori |
| `GET` | `/api/home` | Feed trending gabungan |
| `GET` | `/api/search?q=<query>` | Pencarian judul |
| `GET` | `/api/movie?id=<id>` / `/api/tv?id=<id>` | Detail film / serial |
| `GET` | `/api/tv/seasons?id=<id>` | Daftar musim |
| `GET` | `/api/tv/episodes?id=<id>&season=<n>` | Daftar episode |
| `GET` | `/api/play?id=<id>&type=<movie\|tv>&season=&episode=` | Resolve sumber stream |
| `GET/POST` | `/api/comments?id=<id>` | Baca / kirim komentar |
| `GET/POST` | `/api/likes?id=<id>` | Baca / ubah like-dislike |
| `GET/POST` | `/api/ratings?id=<id>` | Poll rating 1–5 bintang |
| `GET` | `/proxy/hls?url=<m3u8>` | Proxy & rewrite playlist HLS |

## 🚀 Menjalankan Lokal

```bash
npm install
npm start
# → http://localhost:5002
```

## ☁️ Deploy

**Vercel** (serverless):

```bash
vercel --prod
```

`vercel.json` mengarahkan `/api/*` dan `/proxy/hls` ke satu fungsi Node, sementara `public/` dilayani sebagai static output. Playlist HLS di-*rewrite* lewat proxy agar tetap satu origin.

## ⚙️ Konfigurasi

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `5002` | Port server lokal |

## 📝 Catatan

Proyek ini melakukan scraping HTML publik dan hanya untuk keperluan edukasi/demo. Semua hak cipta konten milik pemegangnya masing-masing.

---

<p align="center">Dibuat dengan ❤️ — <b>YukNonton</b></p>