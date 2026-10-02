import { scrapeHome, scrapeMovieDetail, scrapeTvDetail, scrapeSearch, scrapeSeasons, scrapeEpisodes, scrapeCatalog } from '../services/tmdb.service.js';
import { getFromCache, setCache } from '../services/cache.service.js';
import { listCategories, getCatalog, getRows } from '../services/catalog.service.js';
import { resolveMovieStream, resolveTvStream } from '../services/vidlink.service.js';
import { getAnichinCatalog, searchAnichin, getAnichinDetail, resolveAnichinStream } from '../services/anichin.service.js';
import { getComments, addComment, getLikes, applyLikeDelta, getRating, applyRating } from '../services/interactions.service.js';
import { getTvChannels, listTvCategories } from '../services/tv.service.js';
import { getAppVersion } from '../services/appversion.service.js';
import { STREAM_CACHE_TTL_MS, SEARCH_SCOPE_TO_CATALOG, CATALOG_BY_ID } from '../config/constants.js';

// Scope genre pencarian → path katalog genre TMDB (valid, tidak diabaikan server).
const SEARCH_SCOPES = Object.fromEntries(
  Object.entries(SEARCH_SCOPE_TO_CATALOG)
    .map(([scope, catId]) => [scope, CATALOG_BY_ID[catId]?.paths])
    .filter(([, paths]) => Array.isArray(paths) && paths.length)
);

// ── Helper Siaran TV: id = "tv:" + base64url(JSON{u,n,g,l}) — self-contained
function decodeTvId(id) {
  try {
    const json = Buffer.from(String(id).replace(/^tv:/, ''), 'base64url').toString('utf8');
    const o = JSON.parse(json);
    if (o && typeof o.u === 'string' && /^https?:\/\//i.test(o.u)) return o;
  } catch (e) {}
  return null;
}

// In-flight map: dedup request stream yang identik (mis. prefetch + user klik putar).
const streamInflight = new Map();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1e6) { reject(new Error('Payload terlalu besar')); req.destroy(); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('JSON tidak valid')); }
    });
    req.on('error', reject);
  });
}

export async function handleApiRoute(req, res, pathname, parsedUrl) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // ── HOME / TRENDING ──
  if (pathname === '/api/home') {
    const cached = getFromCache('home');
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ cached: true, timestamp: Date.now(), data: cached }));
      return;
    }
    const data = await scrapeHome();
    setCache('home', data);
    res.writeHead(200);
    res.end(JSON.stringify({ cached: false, timestamp: Date.now(), data }));
    return;
  }

  // ── CATEGORIES ──
  if (pathname === '/api/categories') {
    res.writeHead(200);
    res.end(JSON.stringify({ data: listCategories() }));
    return;
  }

  // ── HOME ROWS (baris campuran) ──
  if (pathname === '/api/rows') {
    const data = await getRows();
    res.writeHead(200, { 'Cache-Control': 'public, max-age=120' });
    res.end(JSON.stringify({
      cached: data.cached,
      timestamp: Date.now(),
      count: data.rows.length,
      data: data.rows
    }));
    return;
  }

  // ── CATALOG (per kategori, realtime-aware) ──
  if (pathname === '/api/catalog') {
    const cat = parsedUrl.searchParams.get('cat') || 'trending';
    const page = Number(parsedUrl.searchParams.get('page') || '1') || 1;
    const data = await getCatalog(cat, page);
    res.writeHead(200, { 'Cache-Control': data.realtime ? 'no-store' : 'public, max-age=60' });
    res.end(JSON.stringify({
      category: data.category,
      label: data.label,
      realtime: data.realtime,
      cached: data.cached,
      page,
      timestamp: Date.now(),
      count: data.cards.length,
      data: data.cards
    }));
    return;
  }

  // ── ANICHIN DEDICATED ROUTES ──
  if (pathname === '/api/anichin/catalog') {
    const mode = parsedUrl.searchParams.get('mode') || 'latest';
    const page = Number(parsedUrl.searchParams.get('page') || '1') || 1;
    const cards = await getAnichinCatalog(mode, page);
    res.writeHead(200);
    res.end(JSON.stringify({ mode, page, count: cards.length, data: cards }));
    return;
  }

  if (pathname === '/api/anichin/search') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    const page = Number(parsedUrl.searchParams.get('page') || '1') || 1;
    const cards = await searchAnichin(q, page);
    res.writeHead(200);
    res.end(JSON.stringify({ query: q, page, count: cards.length, data: cards }));
    return;
  }

  if (pathname === '/api/anichin/detail') {
    const slug = parsedUrl.searchParams.get('slug') || '';
    if (!slug) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'slug parameter is required' }));
      return;
    }
    const data = await getAnichinDetail(slug);
    res.writeHead(200);
    res.end(JSON.stringify({ data }));
    return;
  }

  if (pathname === '/api/anichin/play') {
    const ep = parsedUrl.searchParams.get('episode') || '';
    if (!ep) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'episode parameter is required' }));
      return;
    }
    const data = await resolveAnichinStream(ep);
    res.writeHead(200);
    res.end(JSON.stringify({ data }));
    return;
  }

  // ── SIARAN TV LIVE ──
  if (pathname === '/api/tv/categories') {
    res.writeHead(200);
    res.end(JSON.stringify({ data: listTvCategories() }));
    return;
  }

  if (pathname === '/api/tv/channels') {
    const cat = parsedUrl.searchParams.get('cat') || 'sports';
    const sp = parsedUrl.searchParams;
    const data = await getTvChannels(cat, {
      football: sp.get('football') === '1',
      secure: sp.get('secure') === '1',
      q: sp.get('q') || '',
      limit: sp.get('limit') || '120'
    });
    res.writeHead(200, { 'Cache-Control': 'public, max-age=1800' });
    res.end(JSON.stringify(data));
    return;
  }

  // ── VERSI APK (realtime dari GitHub Releases) ──
  if (pathname === '/api/app/version') {
    const v = await getAppVersion();
    res.writeHead(200, { 'Cache-Control': 'public, max-age=600' });
    res.end(JSON.stringify({ data: v }));
    return;
  }

  // ── SEARCH ──
  if (pathname === '/api/search') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    const scope = (parsedUrl.searchParams.get('scope') || 'all').trim().toLowerCase();
    if (!q) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'q parameter is required' }));
      return;
    }
    const key = 'search_' + scope + '_' + q.toLowerCase();
    const cached = getFromCache(key);
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ query: q, scope, cached: true, count: cached.length, data: cached }));
      return;
    }

    let results = [];
    if (SEARCH_SCOPES[scope]) {
      // Scope genre: pakai katalog genre TMDB (filter genre di halaman search
      // web TMDB diabaikan server), lalu cocokkan kata kunci pada judul.
      const paths = SEARCH_SCOPES[scope];
      const pool = await scrapeCatalog(paths).catch(() => []);
      const ql = q.toLowerCase();
      results = pool.filter(x => String(x.name || x.title || '').toLowerCase().includes(ql));
      if (results.length === pool.length || !results.length) results = pool;
    } else if (scope === 'donghua') {
      results = await searchAnichin(q).catch(() => []);
    } else {
      const [anichinResults, tmdbResults] = await Promise.all([
        scope === 'all' ? searchAnichin(q).catch(() => []) : Promise.resolve([]),
        scrapeSearch(q).catch(() => [])
      ]);
      results = [...anichinResults, ...tmdbResults];
      if (scope === 'movie') results = results.filter(x => x.type === 'movie' && !String(x.id).startsWith('anichin:'));
      if (scope === 'tv') results = results.filter(x => x.type === 'tv' && !String(x.id).startsWith('anichin:'));
    }

    if (results.length > 0) setCache(key, results);
    res.writeHead(200);
    res.end(JSON.stringify({ query: q, scope, cached: false, count: results.length, data: results }));
    return;
  }

  // ── MOVIE / TV / ANICHIN DETAIL ──
  if (pathname === '/api/movie' || pathname === '/api/tv' || pathname === '/api/detail') {
    const id = parsedUrl.searchParams.get('id');
    const type = pathname === '/api/tv' ? 'tv' : (parsedUrl.searchParams.get('type') || 'movie');
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id parameter is required' }));
      return;
    }

    if (id.startsWith('tv:')) {
      const tv = decodeTvId(id);
      if (!tv) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        cached: false,
        data: {
          id, type: 'livetv', title: tv.n || 'Siaran TV', name: tv.n || 'Siaran TV',
          poster: tv.l || '', backdrop: tv.l || '', overview: 'Siaran TV langsung (live streaming).',
          genre: tv.g || 'Live TV', genres: [tv.g || 'Live TV'],
          provider: 'iptv', quality: tv.q || '', live: true
        }
      }));
      return;
    }

    if (id.startsWith('anichin:') || type === 'anichin') {
      try {
        const detail = await getAnichinDetail(id);
        res.writeHead(200);
        res.end(JSON.stringify({ cached: false, data: detail }));
      } catch (err) {
        // Fallback: construct valid detail so user can view & watch
        const clean = id.replace(/^anichin:/, '').replace(/-episode-\d+.*$/, '');
        const title = clean.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        res.writeHead(200);
        res.end(JSON.stringify({
          cached: false,
          data: {
            id,
            slug: clean,
            title,
            name: title,
            type: 'anichin',
            provider: 'anichin',
            poster: '',
            backdrop: '',
            overview: 'Serial Donghua Subtitle Indonesia.',
            rating: '8.8',
            genre: 'Donghua, Action, Fantasy',
            genres: ['Donghua', 'Action', 'Fantasy'],
            status: 'Ongoing',
            release: '2025/2026',
            duration: '20 Min',
            episodes_count: 50,
            episodes: []
          }
        }));
      }
      return;
    }

    const key = (type === 'tv' ? 'tv_' : 'movie_') + id;
    const cached = getFromCache(key);
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ cached: true, data: cached }));
      return;
    }
    const detail = type === 'tv'
      ? await scrapeTvDetail(id)
      : await scrapeMovieDetail(id);
    if (!detail || !detail.title) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Media not found', id, type }));
      return;
    }
    setCache(key, detail);
    res.writeHead(200);
    res.end(JSON.stringify({ cached: false, data: detail }));
    return;
  }

  // ── TV SEASONS ──
  if (pathname === '/api/tv/seasons') {
    const id = parsedUrl.searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id parameter is required' }));
      return;
    }
    if (id.startsWith('anichin:')) {
      try {
        const detail = await getAnichinDetail(id);
        res.writeHead(200);
        res.end(JSON.stringify({
          cached: false,
          data: [{
            season: 1,
            season_number: 1,
            name: 'Semua Episode Sub Indo',
            episodes: detail.episodes_count || detail.episodes?.length || 0,
            episode_count: detail.episodes_count || detail.episodes?.length || 0
          }]
        }));
      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({
          cached: false,
          data: [{ season: 1, season_number: 1, name: 'Semua Episode Sub Indo', episodes: 24, episode_count: 24 }]
        }));
      }
      return;
    }

    const key = 'seasons_' + id;
    const cached = getFromCache(key);
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ cached: true, data: cached }));
      return;
    }
    const seasons = await scrapeSeasons(id);
    setCache(key, seasons);
    res.writeHead(200);
    res.end(JSON.stringify({ cached: false, data: seasons }));
    return;
  }

  // ── TV EPISODES ──
  if (pathname === '/api/tv/episodes') {
    const id = parsedUrl.searchParams.get('id');
    const season = parsedUrl.searchParams.get('season') || '1';
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id parameter is required' }));
      return;
    }
    if (id.startsWith('anichin:')) {
      try {
        const detail = await getAnichinDetail(id);
        res.writeHead(200);
        res.end(JSON.stringify({ cached: false, data: detail.episodes || [] }));
      } catch (err) {
        // Fallback: generate episodes 1 to 24 so episode buttons exist
        const clean = id.replace(/^anichin:/, '').replace(/-episode-\d+.*$/, '');
        const eps = [];
        for (let i = 1; i <= 24; i++) {
          const numPad = String(i).padStart(2, '0');
          const epSlug = `${clean}-episode-${numPad}-subtitle-indonesia`;
          eps.push({
            id: `anichin:${epSlug}`,
            slug: epSlug,
            episode: i,
            episode_number: i,
            name: `Episode ${i}`,
            title: `Episode ${i}`,
            air_date: '',
            still_path: ''
          });
        }
        res.writeHead(200);
        res.end(JSON.stringify({ cached: false, data: eps }));
      }
      return;
    }

    const key = `episodes_${id}_s${season}`;
    const cached = getFromCache(key);
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ cached: true, data: cached }));
      return;
    }
    const episodes = await scrapeEpisodes(id, season);
    setCache(key, episodes);
    res.writeHead(200);
    res.end(JSON.stringify({ cached: false, data: episodes }));
    return;
  }

  // ── PLAY / STREAM SOURCE ──
  if (pathname === '/api/play') {
    const id = parsedUrl.searchParams.get('id') || '';
    const type = parsedUrl.searchParams.get('type') || 'movie';
    const season = parsedUrl.searchParams.get('season') || null;
    const episode = parsedUrl.searchParams.get('episode') || null;

    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id parameter is required' }));
      return;
    }

    // Siaran TV: stream HLS langsung, tanpa resolve eksternal.
    if (id.startsWith('tv:') || type === 'livetv') {
      const tv = decodeTvId(id);
      if (!tv) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Channel not found', id }));
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200);
      res.end(JSON.stringify({
        id,
        type: 'livetv',
        playlist: {
          source: 'iptv',
          playlist: tv.u,
          mp4: null,
          qualities: {},
          mirrors: [],
          embed: null,
          captions: []
        },
        live: true,
        channel: tv.n
      }));
      return;
    }

    // Special Anichin handling
    if (id.startsWith('anichin:') || type === 'anichin') {
      try {
        let targetEpSlug = episode;
        const cleanId = id.replace(/^anichin:/, '').replace(/^\/|\/$/g, '');

        // If episode param is empty, an index, or number, find slug from detail
        if (!targetEpSlug || /^\d+$/.test(String(targetEpSlug).trim())) {
          const detail = await getAnichinDetail(id);
          const epNum = targetEpSlug ? parseInt(targetEpSlug, 10) : 1;
          const matched = (detail.episodes || []).find(e => Number(e.episode) === epNum) || detail.episodes?.[0];
          targetEpSlug = matched ? matched.slug : cleanId;
        }

        const stream = await resolveAnichinStream(targetEpSlug);
        if (!stream || (!stream.mp4 && !stream.playlist && !stream.embed)) {
          res.setHeader('Cache-Control', 'no-store');
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Sumber video belum tersedia untuk episode ini.', id, episode: targetEpSlug }));
          return;
        }

        res.setHeader('Cache-Control', 'public, max-age=300');
        res.writeHead(200);
        res.end(JSON.stringify({
          id,
          type: 'anichin',
          playlist: {
            source: 'anichin',
            playlist: stream.playlist || null,
            mp4: stream.mp4 || null,
            qualities: stream.qualities || {},
            mirrors: stream.mirrors || [],
            embed: stream.embed || null,
            captions: []
          },
          season: 1,
          episode: targetEpSlug
        }));
      } catch (err) {
        console.error('[Anichin] Stream error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Gagal memuat video episode ini.', message: err.message }));
      }
      return;
    }

    const cacheKey = type === 'tv'
      ? `stream_tv_${id}_s${season || 1}_e${episode || 1}`
      : `stream_movie_${id}`;

    // Cache di edge CDN Vercel (s-maxage) agar lintas instance tetap cepat.
    const edgeCache = 'public, s-maxage=300, stale-while-revalidate=86400';

    const cached = getFromCache(cacheKey, STREAM_CACHE_TTL_MS);
    if (cached) {
      res.setHeader('Cache-Control', edgeCache);
      res.setHeader('X-Stream-Cache', 'hit');
      res.writeHead(200);
      res.end(JSON.stringify({ id, type, playlist: cached, season, episode }));
      return;
    }

    try {
      let pending = streamInflight.get(cacheKey);
      if (!pending) {
        pending = (type === 'tv' ? resolveTvStream(id, season, episode) : resolveMovieStream(id))
          .finally(() => streamInflight.delete(cacheKey));
        streamInflight.set(cacheKey, pending);
      }
      const playlist = await pending;

      if (!playlist) {
        res.setHeader('Cache-Control', 'no-store');
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Stream not found for this media', id, type }));
        return;
      }

      setCache(cacheKey, playlist, STREAM_CACHE_TTL_MS);
      res.setHeader('Cache-Control', edgeCache);
      res.setHeader('X-Stream-Cache', 'miss');
      res.writeHead(200);
      res.end(JSON.stringify({ id, type, playlist, season, episode }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to resolve stream', message: err.message }));
    }
    return;
  }

  // ── COMMENTS ──
  if (pathname === '/api/comments') {
    const id = parsedUrl.searchParams.get('id') || '';
    if (req.method === 'GET') {
      if (!id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'id parameter is required' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(getComments(id)));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const mediaId = id || body.id || '';
        if (!mediaId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'id parameter is required' }));
          return;
        }
        const comment = addComment(mediaId, body);
        res.writeHead(201);
        res.end(JSON.stringify({ ok: true, data: comment, ...getComments(mediaId) }));
      } catch (err) {
        res.writeHead(err.status || 400);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── LIKES ──
  if (pathname === '/api/likes') {
    const id = parsedUrl.searchParams.get('id') || '';
    if (req.method === 'GET') {
      if (!id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'id parameter is required' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(getLikes(id)));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const mediaId = id || body.id || '';
        if (!mediaId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'id parameter is required' }));
          return;
        }
        const result = applyLikeDelta(mediaId, body.like, body.dislike);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(err.status || 400);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // ── RATING POLL ──
  if (pathname === '/api/ratings') {
    const id = parsedUrl.searchParams.get('id') || '';
    if (req.method === 'GET') {
      if (!id) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'id parameter is required' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(getRating(id)));
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const mediaId = id || body.id || '';
        if (!mediaId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'id parameter is required' }));
          return;
        }
        const result = applyRating(mediaId, body.score ?? body.rating);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        res.writeHead(err.status || 400);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'API endpoint not found' }));
}