import { TMDB_BASE, TMDB_MEDIA, IMG_POSTER } from '../config/constants.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Helpers ───────────────────────────────────────────────────────────────
function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function yearOnly(s) {
  const m = String(s || '').match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : String(s || '').trim();
}

function matchFirst(html, re) {
  const m = html.match(re);
  return m ? (m[1] || m[0]).trim() : '';
}

function upgradePoster(url, size = IMG_POSTER) {
  if (!url) return '';
  return url.replace(/\/t\/p\/w[0-9a-z_]+(?=\/[A-Za-z0-9_]+\.(?:jpg|jpeg|png|webp))/i, `/t/p/${size}`);
}

function firstPosterUrl(html, size = IMG_POSTER) {
  const m = html.match(/https:\/\/media\.themoviedb\.org\/t\/p\/w[0-9a-z_]+\/[A-Za-z0-9_]+\.(?:jpg|jpeg|png|webp)/);
  return m ? upgradePoster(m[0], size) : '';
}

async function fetchPage(pathname) {
  if (pathname.startsWith('/discover/')) return fetchDiscover(pathname);
  const res = await fetch(TMDB_BASE + pathname, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.text();
}

// Halaman /discover di TMDB mengabaikan filter bahasa lewat GET, tetapi
// endpoint partial /discover/<tipe>/items (POST, x-www-form-urlencoded)
// menghormatinya. Dipakai untuk kategori Film Indonesia dan sejenisnya.
async function fetchDiscover(pathname) {
  const qIndex = pathname.indexOf('?');
  const base = qIndex === -1 ? pathname : pathname.slice(0, qIndex);
  const qs = qIndex === -1 ? '' : pathname.slice(qIndex + 1);
  const itemsPath = base.replace(/\/$/, '') + '/items';
  const res = await fetch(TMDB_BASE + itemsPath, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: new URLSearchParams(qs),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  return res.text();
}

// ── Generic card parser (movie + tv) ─────────────────────────────────────
// Setiap kartu: <div id="<hex24>" ... data-object-id="<hex24>" ...>
function parseCards(html) {
  const items = [];
  const seen = new Set();
  const re = /<div id="([0-9a-f]{24})"[^>]*data-object-id="\1"([\s\S]*?)(?=<div id="[0-9a-f]{24}"[^>]*data-object-id=|<footer|<\/main>|$)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const chunk = m[2];
    const href = chunk.match(/href="\/(tv|movie)\/(\d+)(?:-[^"]*)?"/);
    if (!href) continue;
    const type = href[1];
    const id = Number(href[2]);
    const key = type + id;
    if (seen.has(key)) continue;
    seen.add(key);

    const dname = chunk.match(/data-name="([^"]*)"/);
    const h2 = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    const rel = chunk.match(/class="release_date[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    const adult = chunk.match(/data-media-adult="(true|false)"/);

    const name = dname ? stripTags(dname[1]) : (h2 ? stripTags(h2[1]) : '');
    items.push({
      type,
      id,
      name,
      title: name,
      link: `/${type}/${id}`,
      release: rel ? yearOnly(stripTags(rel[1])) : '',
      poster: firstPosterUrl(chunk),
      rating: '',
      adult: adult ? adult[1] === 'true' : false
    });
    if (items.length >= 80) break;
  }
  return items;
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const key = it.type + it.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ── Public: Home / Catalog ───────────────────────────────────────────────
export async function scrapeHome() {
  const [movieHtml, tvHtml] = await Promise.all([
    fetchPage('/movie').catch(() => ''),
    fetchPage('/tv').catch(() => '')
  ]);
  const cards = dedupe([...parseCards(movieHtml), ...parseCards(tvHtml)]).slice(0, 40);
  return { cards, ids: cards.map(c => c.id) };
}

export async function scrapeCatalog(paths = ['/movie']) {
  const htmls = await Promise.all(paths.map(p => fetchPage(p).catch(() => '')));
  const all = [];
  htmls.forEach(h => all.push(...parseCards(h)));
  return dedupe(all);
}

// ── Public: Movie detail ─────────────────────────────────────────────────
export async function scrapeMovieDetail(id) {
  const html = await fetchPage(`/movie/${id}`);

  const title =
    matchFirst(html, /property="og:title" content="([^"]+)"/) ||
    matchFirst(html, /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);

  let genre = '';
  const genreBlock = html.match(/<span class="genres"[^>]*>([\s\S]*?)<\/span>/);
  if (genreBlock) {
    const names = [];
    const gRe = /<a href="\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/g;
    let g;
    while ((g = gRe.exec(genreBlock[1])) !== null) names.push(stripTags(g[1]));
    genre = names.filter(Boolean).join(', ').replace(', and', ',');
  }

  const cert = matchFirst(html, /<span class="certification[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const releaseRaw = matchFirst(html, /<span class="release"[^>]*>([\s\S]*?)<\/span>/) || '';
  const release = releaseRaw.replace(/\s*\([^)]*\)\s*$/, '').trim();

  let rating = '';
  const percent = html.match(/class="user_score_chart"[^>]*data-percent="(\d+)"/);
  if (percent) rating = String(Number(percent[1]) / 10);

  const backdrop = firstPosterUrl(html, 'w1920_and_h800_multi_faces') ||
    firstPosterUrl(html, 'w780') || firstPosterUrl(html, 'original');
  const ogImage = html.match(/property="og:image" content="([^"]+)"/);

  const detail = {
    id: Number(id),
    type: 'movie',
    title,
    tagline: matchFirst(html, /class="tagline"[^>]*>([\s\S]*?)<\/h3>/),
    genre,
    rating,
    release,
    year: yearOnly(release || matchFirst(html, /<span class="tag release_date"[^>]*>\s*\(([^)]+)\)/)),
    duration: stripTags(matchFirst(html, /<span class="runtime"[^>]*>([\s\S]*?)<\/span>/)),
    overview: stripTags(matchFirst(html, /class="overview"[^>]*>[\s\S]{0,160}?<p>([\s\S]*?)<\/p>/)),
    poster: ogImage ? ogImage[1] : firstPosterUrl(html),
    backdrop,
    certification: cert,
    imdb_id: matchFirst(html, /https:\/\/www\.imdb\.com\/title\/(tt\d+)/),
    trailer: '',
    adult: !!cert && /18\b/.test(cert)
  };
  if (detail.poster && !detail.poster.startsWith('http')) {
    detail.poster = TMDB_MEDIA + '/' + IMG_POSTER + '/' + detail.poster;
  }
  return detail;
}

// ── Public: TV detail ────────────────────────────────────────────────────
export async function scrapeTvDetail(id) {
  const html = await fetchPage(`/tv/${id}`);

  const title =
    matchFirst(html, /property="og:title" content="([^"]+)"/) ||
    matchFirst(html, /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);

  let genre = '';
  const genreBlock = html.match(/<span class="genres"[^>]*>([\s\S]*?)<\/span>/);
  if (genreBlock) {
    const names = [];
    const gRe = /<a href="\/genre\/[^"]+"[^>]*>([^<]+)<\/a>/g;
    let g;
    while ((g = gRe.exec(genreBlock[1])) !== null) names.push(stripTags(g[1]));
    genre = names.filter(Boolean).join(', ').replace(', and', ',');
  }

  let rating = '';
  const percent = html.match(/class="user_score_chart"[^>]*data-percent="(\d+)"/);
  if (percent) rating = String(Number(percent[1]) / 10);

  const releaseRaw = matchFirst(html, /<span class="tag release_date">\s*\(([^)]+)\)/) ||
    matchFirst(html, /class="release_date"[^>]*>([\s\S]*?)<\/span>/) ||
    matchFirst(html, /<span class="release"[^>]*>([\s\S]*?)<\/span>/) || '';
  const release = releaseRaw.replace(/\s*\([^)]*\)\s*$/, '').trim();

  const network = stripTags(matchFirst(html, /<ul class="networks">[\s\S]{0,200}?<img[^>]*alt="([^"]*)"/))
    .replace(/^See more TV shows from\s*/i, '')
    .replace(/\.\.\.$/, '')
    .trim();

  const backdrop = firstPosterUrl(html, 'w1920_and_h800_multi_faces') ||
    firstPosterUrl(html, 'w780') || firstPosterUrl(html, 'original');
  const ogImage = html.match(/property="og:image" content="([^"]+)"/);

  const detail = {
    id: Number(id),
    type: 'tv',
    title,
    genre,
    rating,
    release,
    year: yearOnly(release),
    duration: stripTags(matchFirst(html, /class="runtime"[^>]*>([\s\S]*?)<\/span>/)) ||
      stripTags(matchFirst(html, /class="episode_run_time"[^>]*>([\s\S]*?)<\/span>/)),
    seasons: Number(matchFirst(html, /data-number-of-seasons="(\d+)"/)) || null,
    episodes: null,
    network,
    overview: stripTags(matchFirst(html, /class="overview"[^>]*>[\s\S]{0,160}?<p>([\s\S]*?)<\/p>/)),
    poster: ogImage ? ogImage[1] : firstPosterUrl(html),
    backdrop,
    certification: matchFirst(html, /<span class="certification[^"]*"[^>]*>([\s\S]*?)<\/span>/),
    imdb_id: matchFirst(html, /https:\/\/www\.imdb\.com\/title\/(tt\d+)/),
    trailer: '',
    adult: false
  };
  if (detail.poster && !detail.poster.startsWith('http')) {
    detail.poster = TMDB_MEDIA + '/' + IMG_POSTER + '/' + detail.poster;
  }
  return detail;
}

// ── Public: Search ───────────────────────────────────────────────────────
export async function scrapeSearch(query) {
  const html = await fetchPage(`/search?query=${encodeURIComponent(query)}`);
  return parseCards(html).slice(0, 40);
}

// ── Public: Seasons & Episodes ───────────────────────────────────────────
export async function scrapeSeasons(id) {
  const html = await fetchPage(`/tv/${id}/seasons`);
  const out = [];
  const re = new RegExp(`<a href="\\/tv\\/${id}(?:-[^"]*)?\\/season\\/(\\d+)">([\\s\\S]{0,900}?)(?=<a href="\\/tv\\/${id}(?:-[^"]*)?\\/season\\/\\d+">|$)`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const block = m[2] || '';
    const epCount = block.match(/(\d+)\s*Episode/i);
    const poster = firstPosterUrl(block);
    out.push({ season: Number(m[1]), episodes: epCount ? Number(epCount[1]) : null, poster });
  }
  const map = new Map();
  out.forEach(s => {
    const prev = map.get(s.season);
    if (!prev || (s.episodes || 0) > (prev.episodes || 0)) map.set(s.season, s);
  });
  return [...map.values()].sort((a, b) => a.season - b.season);
}

export async function scrapeEpisodes(id, season) {
  const html = await fetchPage(`/tv/${id}/season/${season}`);
  const out = [];
  const re = new RegExp(`<div class="card" data-object-id="[0-9a-f]+" data-url="\\/tv\\/${id}(?:-[^"]*)?\\/season\\/(\\d+)\\/episode\\/(\\d+)">([\\s\\S]*?)(?=<div class="card" data-object-id="|<\\/section>|$)`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const ep = Number(m[2]);
    const block = m[3] || '';
    const alt = block.match(/\balt="([^"]*)"/);
    const num = block.match(/data-episode-number="(\d+)"/);
    const titleAttr = block.match(/\btitle="([^"]*)"/);
    const overview = block.match(/class="overview"[^>]*>([\s\S]{0,500}?)<\/(?:p|div)>/);
    let name = alt ? stripTags(alt[1]) : '';
    if (!name && titleAttr) {
      const parts = titleAttr[1].split(' - ');
      name = stripTags(parts[parts.length - 1]);
    }
    out.push({
      season: Number(m[1]),
      episode: num ? Number(num[1]) : ep,
      name,
      overview: overview ? stripTags(overview[1]).slice(0, 300) : '',
      still: firstPosterUrl(block, 'w227_and_h127_face')
    });
  }
  const map = new Map();
  out.forEach(e => { if (!map.has(e.episode)) map.set(e.episode, e); });
  return [...map.values()].sort((a, b) => a.episode - b.episode);
}