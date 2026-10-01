export const PORT = process.env.PORT || 5002;
export const PUBLIC_DIR = 'public';
export const CACHE_TTL_MS = 5 * 60 * 1000;

export const TMDB_BASE = 'https://www.themoviedb.org';
export const TMDB_MEDIA = 'https://media.themoviedb.org/t/p';
export const IMG_POSTER = 'w220_and_h330_face';
export const IMG_BACKDROP = 'w780';

export const SCRAPER = {
  origin: 'https://vidlink.pro',
  referer: 'https://vidlink.pro/',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

// ── Catalog ───────────────────────────────────────────────────────────────
// TMDB web mengabaikan filter bahasa di server, tapi halaman /keyword & /genre
// valid. Setiap kategori memetakan ke satu/lebih sumber path + tipe media.
// realtime=true → TTL pendek (update cepat, mis. tayang hari ini / on the air).
export const CATALOG = [
  { id: 'trending',       label: 'Trending',        icon: 'trending',  paths: ['/movie', '/tv'],                          ttl: 300 },
  // ── Film Indonesia (lengkap) — movie + serial, urut popularitas ──
  { id: 'film-indonesia',      label: 'Film Indonesia',     icon: 'flag',   paths: ['/discover/movie?with_original_language=id&sort_by=popularity.desc'], ttl: 300, realtime: true },
  { id: 'film-indonesia-new',  label: 'Indonesia Terbaru',  icon: 'zap',    paths: ['/discover/movie?with_original_language=id&sort_by=primary_release_date.desc'], ttl: 300, realtime: true },
  { id: 'film-indonesia-top',  label: 'Indonesia Top',      icon: 'award',  paths: ['/discover/movie?with_original_language=id&sort_by=vote_average.desc&vote_count.gte=20'], ttl: 600 },
  { id: 'serial-indonesia',    label: 'Serial Indonesia',   icon: 'tv',     paths: ['/discover/tv?with_original_language=id&sort_by=popularity.desc'], ttl: 300, realtime: true },
  { id: 'indonesia-horor',     label: 'Horor Indonesia',    icon: 'ghost',  paths: ['/discover/movie?with_original_language=id&with_genres=27&sort_by=popularity.desc'], ttl: 600 },
  { id: 'indonesia-komedi',    label: 'Komedi Indonesia',   icon: 'smile',  paths: ['/discover/movie?with_original_language=id&with_genres=35&sort_by=popularity.desc'], ttl: 600 },
  { id: 'indonesia-drama',     label: 'Drama Indonesia',    icon: 'masks',  paths: ['/discover/movie?with_original_language=id&with_genres=18&sort_by=popularity.desc'], ttl: 600 },
  { id: 'serial-airing',  label: 'Serial Hari Ini', icon: 'broadcast', paths: ['/tv/airing-today'],                        ttl: 120, realtime: true },
  { id: 'serial-onair',   label: 'Sedang Tayang',   icon: 'signal',    paths: ['/tv/on-the-air'],                          ttl: 120, realtime: true },
  { id: 'anime',          label: 'Anime',           icon: 'sparkles',  paths: ['/keyword/210024-anime/tv', '/keyword/210024-anime/movie'], ttl: 600 },
  { id: 'anime-update',   label: 'Anime Update',    icon: 'zap',       paths: ['/keyword/210024-anime/tv'],                ttl: 120, realtime: true },
  { id: 'anime-film',     label: 'Anime Movie',     icon: 'film',      paths: ['/keyword/210024-anime/movie'],             ttl: 600 },
  { id: 'donghua',          label: 'Donghua Terbaru', icon: 'sparkles',  provider: 'anichin', mode: 'latest',    paths: ['/keyword/315535-donghua/tv'],    ttl: 120, realtime: true },
  { id: 'donghua-ongoing',  label: 'Donghua Ongoing', icon: 'broadcast', provider: 'anichin', mode: 'ongoing',   paths: ['/keyword/315535-donghua/tv'],    ttl: 180, realtime: true },
  { id: 'donghua-viral',    label: 'Donghua Populer', icon: 'zap',        provider: 'anichin', mode: 'popular',   paths: ['/keyword/315535-donghua/tv'],    ttl: 300 },
  { id: 'donghua-film',     label: 'Donghua Movie',   icon: 'film',       provider: 'anichin', mode: 'movie',     paths: ['/keyword/315535-donghua/movie'], ttl: 600 },
  { id: 'donghua-completed',label: 'Donghua Tamat',   icon: 'award',      provider: 'anichin', mode: 'completed', paths: ['/keyword/315535-donghua/tv'],    ttl: 600 },
  { id: 'drama-china',    label: 'Drama China',     icon: 'globe',     paths: ['/keyword/184656-wuxia/tv', '/keyword/377428-chinese-drama/tv'], ttl: 600 },
  { id: 'drama-jepang',   label: 'Drama Jepang',    icon: 'globe',     paths: ['/keyword/327811-japanese-drama/tv'],       ttl: 600 },
  { id: 'drama-korea',    label: 'Drama Korea',     icon: 'globe',     paths: ['/keyword/272877-korean/tv'],               ttl: 600 },
  { id: 'film',           label: 'Film',            icon: 'film',      paths: ['/movie'],                                  ttl: 600 },
  { id: 'film-now',       label: 'Film Terbaru',    icon: 'film',      paths: ['/movie/now-playing'],                      ttl: 300 },
  { id: 'film-top',       label: 'Film Top',        icon: 'star',      paths: ['/movie/top-rated'],                        ttl: 900 },
  { id: 'film-upcoming',  label: 'Akan Tayang',     icon: 'calendar',  paths: ['/movie/upcoming'],                         ttl: 600 },
  { id: 'serial',         label: 'Serial',          icon: 'tv',        paths: ['/tv'],                                     ttl: 600 },
  { id: 'serial-top',     label: 'Serial Top',      icon: 'award',     paths: ['/tv/top-rated'],                           ttl: 900 },
  { id: 'animasi',        label: 'Animasi',         icon: 'palette',   paths: ['/genre/16/movie', '/genre/16/tv'],        ttl: 900 },
  { id: 'aksi',           label: 'Aksi',            icon: 'zap',       paths: ['/genre/28/movie'],                         ttl: 900 },
  { id: 'drama',          label: 'Drama',           icon: 'masks',     paths: ['/genre/18/movie', '/genre/18/tv'],        ttl: 900 },
  { id: 'horor',          label: 'Horor',           icon: 'ghost',     paths: ['/genre/27/movie'],                         ttl: 900 },
  { id: 'komedi',         label: 'Komedi',          icon: 'smile',     paths: ['/genre/35/movie'],                         ttl: 900 },
  { id: 'romantis',       label: 'Romantis',        icon: 'heart',     paths: ['/genre/10749/movie'],                      ttl: 900 },
  { id: 'petualangan',    label: 'Petualangan',     icon: 'compass',   paths: ['/genre/12/movie'],                         ttl: 900 },
  { id: 'misteri',        label: 'Misteri',         icon: 'search',    paths: ['/genre/9648/movie'],                       ttl: 900 },
  { id: 'scifi',          label: 'Sci-Fi',          icon: 'rocket',    paths: ['/genre/878/movie'],                        ttl: 900 },
  { id: 'thriller',       label: 'Thriller',        icon: 'target',    paths: ['/genre/53/movie'],                         ttl: 900 },
  { id: 'fantasi',        label: 'Fantasi',         icon: 'wand',      paths: ['/genre/14/movie'],                         ttl: 900 },
  { id: 'keluarga',       label: 'Keluarga',        icon: 'users',     paths: ['/genre/10751/movie'],                      ttl: 900 },
  { id: 'dokumenter',     label: 'Dokumenter',      icon: 'book',      paths: ['/genre/99/movie'],                         ttl: 900 }
];

export const CATALOG_BY_ID = Object.fromEntries(CATALOG.map(c => [c.id, c]));

// ── Home rows (baris campuran di bawah kategori) ──────────────────────────
// Setiap baris menggabungkan beberapa kategori lalu diacak-merata (round-robin)
// agar campuran film/serial/dari banyak sumber. `limit` = jumlah kartu.
export const ROWS = [
  { id: 'rekomendasi', label: 'Rekomendasi Untukmu', icon: 'sparkles', limit: 16, cats: ['trending', 'film-indonesia', 'film-now', 'serial-airing', 'anime'] },
  { id: 'trending-now', label: 'Trending Hari Ini',   icon: 'trending', limit: 16, cats: ['trending', 'film-indonesia-new', 'serial-onair', 'anime-update'] },
  { id: 'favorit',      label: 'Favorit Pengguna',    icon: 'heart',    limit: 16, cats: ['film-indonesia-top', 'film-top', 'serial-top', 'drama-korea'] },
  { id: 'indonesia',    label: 'Indonesia Pilihan',   icon: 'flag',     limit: 16, cats: ['film-indonesia', 'serial-indonesia', 'indonesia-horor', 'indonesia-komedi', 'indonesia-drama'] },
  { id: 'serial',       label: 'Serial Populer',      icon: 'tv',       limit: 14, cats: ['serial', 'serial-airing', 'serial-onair'] },
  { id: 'anime',        label: 'Anime & Donghua',     icon: 'sparkles', limit: 14, cats: ['anime', 'anime-film', 'donghua', 'donghua-film'] },
  { id: 'drama-asia',   label: 'Drama Asia',          icon: 'globe',    limit: 14, cats: ['drama-korea', 'drama-china', 'drama-jepang'] },
  { id: 'malam',        label: 'Horor & Thriller',    icon: 'ghost',    limit: 14, cats: ['horor', 'thriller', 'misteri'] }
];

// TTL cache khusus katalog (ms). Cache service default tetap 5 menit.
export const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
export const REALTIME_CACHE_TTL_MS = 90 * 1000;

// Cache hasil resolve stream (vidlink) — membuat putar ulang & ganti-ganti judul instan.
export const STREAM_CACHE_TTL_MS = 15 * 60 * 1000;