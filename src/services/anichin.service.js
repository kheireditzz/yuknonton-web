import { getFromCache, setCache } from './cache.service.js';

const PRIMARY_BASE = 'https://anichin.moe';
const FALLBACK_BASES = ['https://anichin.care', 'https://anichin.club'];
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let currentBase = PRIMARY_BASE;

/**
 * Fetch HTML with automatic domain fallback and redirect following
 */
async function fetchHtml(urlPath) {
  const tryBases = [currentBase, ...FALLBACK_BASES.filter(b => b !== currentBase)];
  let lastError = null;

  for (const base of tryBases) {
    try {
      const url = urlPath.startsWith('http')
        ? urlPath
        : `${base}${urlPath.startsWith('/') ? urlPath : '/' + urlPath}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': `${base}/`,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Update active base if redirect landed on different domain
      try {
        const finalUrl = new URL(res.url);
        if (finalUrl.origin && finalUrl.origin !== currentBase) {
          currentBase = finalUrl.origin;
        }
      } catch (e) {}

      return await res.text();
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Gagal menghubungi Anichin');
}

/**
 * Parse card articles from Anichin list pages
 */
function parseAnichinCards(html) {
  const cards = [];
  const articleRegex = /<article[^>]*class="[^"]*bs[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    const art = match[1];
    const linkMatch = art.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!linkMatch) continue;

    const rawHref = linkMatch[1];
    let slug = rawHref.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/|\/$/g, '');

    // Title & headline
    const titleMatch = art.match(/<div class="tt">([^<]+)/i) || art.match(/title="([^"]+)"/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Donghua';

    // Poster image
    const imgMatch = art.match(/<img[^>]*src="([^"]+)"/i) || art.match(/data-lazy-src="([^"]+)"/i);
    let poster = imgMatch ? imgMatch[1] : '';
    if (poster && !poster.startsWith('http')) {
      poster = `${currentBase}${poster.startsWith('/') ? '' : '/'}${poster}`;
    }

    // Episode badge / status (e.g. "Ep 16", "Ongoing", "Completed")
    const epxMatch = art.match(/<span class="epx">([^<]+)<\/span>/i);
    const epx = epxMatch ? epxMatch[1].trim() : '';

    const statusMatch = art.match(/<div class="status[^"]*">([^<]+)<\/div>/i);
    const statusText = statusMatch ? statusMatch[1].trim() : (epx || 'Donghua');

    const typeMatch = art.match(/<div class="typez[^"]*">([^<]+)<\/div>/i);
    const animeType = typeMatch ? typeMatch[1].trim() : 'Donghua';

    // Parse numeric episode if present
    const epNum = epx.replace(/[^0-9]/g, '') || null;

    cards.push({
      id: `anichin:${slug}`,
      slug,
      name: title,
      title,
      type: 'anichin',
      provider: 'anichin',
      poster,
      poster_path: poster,
      status: statusText,
      episode: epNum,
      badge: epx || statusText,
      release: '2025/2026',
      rating: '8.8',
      media_type: 'anichin'
    });
  }

  return cards;
}

/**
 * Get Anichin catalog by category mode
 * Modes: 'latest' (default), 'ongoing', 'popular', 'movie', 'completed'
 */
export async function getAnichinCatalog(mode = 'latest', page = 1) {
  const cacheKey = `anichin_cat_${mode}_p${page}`;
  const cached = getFromCache(cacheKey, 3 * 60 * 1000);
  if (cached) return cached;

  let path = '';
  switch (mode) {
    case 'ongoing':
      path = page > 1 ? `/ongoing/page/${page}/` : '/ongoing/';
      break;
    case 'popular':
      path = page > 1 ? `/anime/page/${page}/?order=popular` : '/anime/?order=popular';
      break;
    case 'movie':
      path = page > 1 ? `/anime/page/${page}/?type=movie` : '/anime/?type=movie';
      break;
    case 'completed':
      path = page > 1 ? `/completed/page/${page}/` : '/completed/';
      break;
    case 'latest':
    default:
      path = page > 1 ? `/page/${page}/` : '/';
      break;
  }

  const html = await fetchHtml(path);
  const cards = parseAnichinCards(html);
  setCache(cacheKey, cards, 3 * 60 * 1000);
  return cards;
}

/**
 * Search Donghua on Anichin
 */
export async function searchAnichin(query, page = 1) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const cacheKey = `anichin_search_${q}_p${page}`;
  const cached = getFromCache(cacheKey, 5 * 60 * 1000);
  if (cached) return cached;

  const path = page > 1
    ? `/page/${page}/?s=${encodeURIComponent(q)}`
    : `/?s=${encodeURIComponent(q)}`;

  const html = await fetchHtml(path);
  const cards = parseAnichinCards(html);
  setCache(cacheKey, cards, 5 * 60 * 1000);
  return cards;
}

/**
 * Extract root series slug if an episode slug was given
 */
export function extractSeriesSlug(slug) {
  return slug
    .replace(/^anichin:/, '')
    .replace(/-episode-\d+.*$/, '')
    .replace(/^\/|\/$/g, '');
}

/**
 * Get detailed information for an Anichin Donghua series
 */
export async function getAnichinDetail(rawSlug) {
  const clean = rawSlug.replace(/^anichin:/, '').replace(/^\/|\/$/g, '');
  const seriesSlug = extractSeriesSlug(clean);
  const cacheKey = `anichin_detail_${seriesSlug}`;
  const cached = getFromCache(cacheKey, 10 * 60 * 1000);
  if (cached) return cached;

  let html;
  try {
    html = await fetchHtml(`/${seriesSlug}/`);
  } catch (err) {
    // If not found, try original clean slug
    if (clean !== seriesSlug) {
      html = await fetchHtml(`/${clean}/`);
    } else {
      throw err;
    }
  }

  // Title
  const titleMatch = html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>(.*?)<\/h1>/i) ||
                     html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : seriesSlug.replace(/-/g, ' ');

  // Poster & Backdrop
  const thumbMatch = html.match(/<div class="thumb"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i) ||
                     html.match(/<div class="bigcontent"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
  let poster = thumbMatch ? thumbMatch[1] : '';
  if (poster && !poster.startsWith('http')) {
    poster = `${currentBase}${poster.startsWith('/') ? '' : '/'}${poster}`;
  }

  // Synopsis / Overview
  const descMatch = html.match(/<div[^>]*class="[^"]*desc mindes[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                    html.match(/<div[^>]*class="[^"]*entry-content_wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                    html.match(/<div itemprop="description"[^>]*>([\s\S]*?)<\/div>/i);
  const overview = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Rating
  const ratingMatch = html.match(/<div class="rating"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/i) ||
                      html.match(/<span class="rating"[^>]*>([^<]+)<\/span>/i);
  const rating = ratingMatch ? ratingMatch[1].replace(/[^0-9.]/g, '').trim() : '8.8';

  // Genres
  const genxMatch = html.match(/<div class="genxed"[^>]*>([\s\S]*?)<\/div>/i);
  const genres = [];
  if (genxMatch) {
    const aRegex = /<a[^>]*>([^<]+)<\/a>/gi;
    let gm;
    while ((gm = aRegex.exec(genxMatch[1])) !== null) {
      const g = gm[1].trim();
      if (g && !genres.includes(g)) genres.push(g);
    }
  }

  // Info details (Status, Studio, Released, Duration, Type)
  const speMatch = html.match(/<div class="spe"[^>]*>([\s\S]*?)<\/div>/i);
  let status = 'Ongoing';
  let release = '2025';
  let duration = '20 Min';
  let studio = '';

  if (speMatch) {
    const spanRegex = /<span><b>([^<]+):<\/b>\s*([\s\S]*?)<\/span>/gi;
    let sm;
    while ((sm = spanRegex.exec(speMatch[1])) !== null) {
      const key = sm[1].trim().toLowerCase();
      const val = sm[2].replace(/<[^>]+>/g, '').trim();
      if (key.includes('status')) status = val;
      if (key.includes('released') || key.includes('rilis')) release = val;
      if (key.includes('duration') || key.includes('durasi')) duration = val;
      if (key.includes('studio')) studio = val;
    }
  }

  // Episode list
  const episodes = [];
  const ulMatch = html.match(/<div[^>]*class="[^"]*eplister[^"]*"[^>]*>[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (ulMatch) {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let lm;
    while ((lm = liRegex.exec(ulMatch[1])) !== null) {
      const li = lm[1];
      const href = (li.match(/href="([^"]+)"/i) || [])[1];
      const numStr = (li.match(/class="epl-num">([^<]+)</i) || [])[1];
      const epTitle = (li.match(/class="epl-title">([^<]+)</i) || [])[1];
      const epDate = (li.match(/class="epl-date">([^<]+)</i) || [])[1];

      if (href) {
        const epSlug = href.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/|\/$/g, '');
        const epNum = numStr ? parseInt(numStr, 10) : (episodes.length + 1);
        episodes.push({
          id: `anichin:${epSlug}`,
          slug: epSlug,
          episode: isNaN(epNum) ? episodes.length + 1 : epNum,
          episode_number: isNaN(epNum) ? episodes.length + 1 : epNum,
          name: epTitle || `Episode ${numStr || (episodes.length + 1)}`,
          title: epTitle || `Episode ${numStr || (episodes.length + 1)}`,
          air_date: epDate || '',
          still_path: poster
        });
      }
    }
  }

  // Urutkan episode dari episode 1 ke episode terakhir
  episodes.sort((a, b) => a.episode - b.episode);

  const detail = {
    id: `anichin:${seriesSlug}`,
    slug: seriesSlug,
    title,
    name: title,
    type: 'anichin',
    provider: 'anichin',
    poster,
    poster_path: poster,
    backdrop: poster,
    backdrop_path: poster,
    overview,
    rating,
    genre: genres.join(', ') || 'Donghua, Action, Fantasy',
    genres,
    status,
    release,
    duration,
    studio,
    episodes_count: episodes.length,
    episodes
  };

  setCache(cacheKey, detail, 10 * 60 * 1000);
  return detail;
}

/**
 * Resolve video stream & qualities from an episode page
 */
export async function resolveAnichinStream(rawEpisodeSlug) {
  const epSlug = rawEpisodeSlug.replace(/^anichin:/, '').replace(/^\/|\/$/g, '');
  const cacheKey = `anichin_stream_${epSlug}`;
  const cached = getFromCache(cacheKey, 15 * 60 * 1000);
  if (cached) return cached;

  const html = await fetchHtml(`/${epSlug}/`);
  const mirrorMatch = html.match(/<select[^>]*class="[^"]*mirror[^"]*"[^>]*>([\s\S]*?)<\/select>/i);

  const mirrors = [];
  let streamResult = null;

  if (mirrorMatch) {
    const optRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
    let opt;

    while ((opt = optRegex.exec(mirrorMatch[1])) !== null) {
      const val = opt[1];
      const label = opt[2].replace(/<[^>]+>/g, '').trim();
      if (!val) continue;

      try {
        const decoded = Buffer.from(val, 'base64').toString('utf8');
        const iframeMatch = decoded.match(/src="([^"]+)"/i);
        if (iframeMatch) {
          const embedUrl = iframeMatch[1];
          const isOkRu = label.toLowerCase().includes('ok') || embedUrl.includes('ok.ru');

          mirrors.push({
            name: label.replace(/\[ADS\]/gi, '').trim() || 'Mirror',
            rawName: label,
            url: embedUrl,
            isOkRu
          });

          // Extract direct streams from OK.ru if not already extracted
          if (isOkRu && !streamResult) {
            try {
              const okRes = await fetch(embedUrl, {
                headers: { 'User-Agent': USER_AGENT },
                signal: AbortSignal.timeout(10000)
              });
              const okHtml = await okRes.text();
              const optDataMatch = okHtml.match(/data-options="([^"]+)"/);

              if (optDataMatch) {
                const optData = JSON.parse(optDataMatch[1].replace(/&quot;/g, '"'));
                const meta = optData?.flashvars?.metadata;
                const vids = meta?.videos || [];
                const qualities = {};
                const resMap = {
                  mobile: '360',
                  lowest: '144',
                  low: '240',
                  sd: '480',
                  hd: '720',
                  full: '1080'
                };

                vids.forEach(v => {
                  const resKey = resMap[v.name] || v.name;
                  if (v.url) qualities[resKey] = v.url;
                });

                const bestDirect = qualities['720'] || qualities['1080'] || qualities['480'] || vids[0]?.url || null;
                const hlsUrl = meta?.hlsManifestUrl || null;

                if (bestDirect || hlsUrl) {
                  streamResult = {
                    source: 'anichin',
                    playlist: hlsUrl,
                    mp4: bestDirect,
                    qualities,
                    captions: []
                  };
                }
              }
            } catch (okErr) {
              console.warn('[Anichin] Failed to extract OK.ru embed data:', okErr.message);
            }
          }
        }
      } catch (decodeErr) {}
    }
  }

  // Fallback: If direct OK.ru stream wasn't found, use first mirror as iframe embed
  if (!streamResult) {
    const firstEmbed = mirrors[0]?.url || null;
    streamResult = {
      source: 'anichin',
      playlist: null,
      mp4: null,
      qualities: {},
      embed: firstEmbed,
      captions: []
    };
  }

  streamResult.mirrors = mirrors;
  setCache(cacheKey, streamResult, 15 * 60 * 1000);
  return streamResult;
}
