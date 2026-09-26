import http from 'node:http';
import https from 'node:https';
import { SCRAPER } from '../config/constants.js';

const MAX_REDIRECTS = 6;

function fetchUpstream(url, transportHeaders = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const host = String(url).toLowerCase();
    // CDN stream (bcdn.hakunaymatata.com, dll) justru menolak jika menerima header
    // Referer/Origin dari vidlink (429). Header itu hanya wajib untuk API vidlink.pro.
    const needsReferer = host.includes('vidlink.pro') || host.includes('vidsrc') || host.includes('2embed');
    const headers = {
      Accept: '*/*'
    };
    if (needsReferer) {
      headers.Referer = SCRAPER.referer;
      headers.Origin = SCRAPER.origin;
      headers['User-Agent'] = SCRAPER.userAgent;
    }
    if (transportHeaders.range) headers.Range = transportHeaders.range;
    const req = mod.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const loc = res.headers.location;
        return resolve(fetchUpstream(loc.startsWith('http') ? loc : new URL(loc, url).href, transportHeaders, redirects + 1));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('upstream timeout')));
  });
}

function rewriteM3u8(body, url) {
  const base = url.split('?')[0];
  const baseDir = base.substring(0, base.lastIndexOf('/') + 1);
  const origin = new URL(url).origin;
  return body.split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const abs = t.startsWith('http') ? t : t.startsWith('/') ? origin + t : baseDir + t;
    return '/proxy/hls?url=' + encodeURIComponent(abs);
  }).join('\n');
}

export async function proxyHls(req, res, parsedUrl) {
  const rawUrl = parsedUrl.searchParams.get('url');
  if (!rawUrl) {
    res.writeHead(400);
    res.end('missing url');
    return;
  }
  const url = decodeURIComponent(rawUrl);
  const range = req.headers.range;
  const upstream = await fetchUpstream(url, { range });

  const ct = (upstream.headers['content-type'] || '').toLowerCase();
  const isM3u8 = ct.includes('mpegurl') || ct.includes('m3u8') || /\.m3u8?(\?|$)/i.test(url.split('?')[0]);

  if (isM3u8) {
    const chunks = [];
    for await (const chunk of upstream) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.writeHead(200);
    res.end(rewriteM3u8(body, url));
    return;
  }

  res.setHeader('Content-Type', ct || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (upstream.headers['content-length']) {
    res.setHeader('Content-Length', upstream.headers['content-length']);
  }
  if (upstream.headers['content-range']) {
    res.setHeader('Content-Range', upstream.headers['content-range']);
    res.setHeader('Accept-Ranges', 'bytes');
  }
  res.statusCode = upstream.statusCode || 200;
  upstream.pipe(res);
}