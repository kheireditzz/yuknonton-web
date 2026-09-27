import { scrapeHome, scrapeMovieDetail, scrapeTvDetail, scrapeSearch, scrapeSeasons, scrapeEpisodes } from '../services/tmdb.service.js';
import { getFromCache, setCache } from '../services/cache.service.js';
import { listCategories, getCatalog, getRows } from '../services/catalog.service.js';
import { resolveMovieStream, resolveTvStream } from '../services/vidlink.service.js';
import { getComments, addComment, getLikes, applyLikeDelta, getRating, applyRating } from '../services/interactions.service.js';
import { STREAM_CACHE_TTL_MS } from '../config/constants.js';

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

  // ── SEARCH ──
  if (pathname === '/api/search') {
    const q = (parsedUrl.searchParams.get('q') || '').trim();
    if (!q) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'q parameter is required' }));
      return;
    }
    const key = 'search_' + q.toLowerCase();
    const cached = getFromCache(key);
    if (cached) {
      res.writeHead(200);
      res.end(JSON.stringify({ query: q, cached: true, count: cached.length, data: cached }));
      return;
    }
    const results = await scrapeSearch(q);
    if (results.length > 0) setCache(key, results);
    res.writeHead(200);
    res.end(JSON.stringify({ query: q, cached: false, count: results.length, data: results }));
    return;
  }

  // ── MOVIE / TV DETAIL ──
  if (pathname === '/api/movie' || pathname === '/api/tv') {
    const id = parsedUrl.searchParams.get('id');
    const type = pathname === '/api/tv' ? 'tv' : (parsedUrl.searchParams.get('type') || 'movie');
    if (!id) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'id parameter is required' }));
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