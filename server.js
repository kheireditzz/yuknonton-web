import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './src/config/constants.js';
import { handleApiRoute } from './src/routes/api.routes.js';
import { proxyHls } from './src/routes/hls.proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

export async function handleRequest(req, res) {
  // Vercel catch-all rewrite menimpa req.url menjadi /api/[...path] (atau
  // /api/index). Rekonstruksi path asli dari header rewrite bila ada.
  const rewritten = process.env.VERCEL_REWRITE ?? req.headers['x-vercel-rewrite-path'] ?? req.headers['x-mw-path'] ?? '';
  if (rewritten && rewritten.startsWith('/')) {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    req.url = rewritten + q;
  }
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = parsedUrl.pathname;
  // Alias internal: rewrite Vercel /proxy/hls → /api/proxy-hls
  if (pathname === '/api/proxy-hls') pathname = '/proxy/hls';

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API
  if (pathname.startsWith('/api/')) {
    try {
      await handleApiRoute(req, res, pathname, parsedUrl);
    } catch (err) {
      console.error(`API Error on ${pathname}:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
      }
    }
    return;
  }

  // HLS proxy
  if (pathname === '/proxy/hls') {
    try {
      await proxyHls(req, res, parsedUrl);
    } catch (err) {
      console.error('HLS proxy error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    }
    return;
  }

  // Static
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (ext === '.css' || ext === '.js') {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    stream.pipe(res);
  });
}

// Start
if (process.env.NODE_ENV !== 'test' && (!process.env.VERCEL || process.env.VERCEL === '0')) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[YukNonton] Server running on http://localhost:${PORT}`);
  });
}

export default handleRequest;