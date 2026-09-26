import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRAPER } from '../config/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let wasmReady = false;
let bootPromise = null;

async function bootWasm() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    globalThis.window = globalThis;
    globalThis.self = globalThis;
    globalThis.document = { createElement: () => ({}), body: { appendChild: () => {} } };

    const sodium = await import('libsodium-wrappers');
    await sodium.default.ready;
    globalThis.sodium = sodium.default;

    const root = path.resolve(__dirname, '..', 'scraper');
    const boot = fs.readFileSync(path.join(root, 'wasm-bootstrap.js'), 'utf8');
    // Bootstrapper sets globalThis.Dm; adapt the leading "use strict" wrapper
    new Function(boot.replace(/^["']use strict["'];\s*/, ''))();

    const go = new globalThis.Dm();
    const wasmBuf = fs.readFileSync(path.join(root, 'fu.wasm'));
    const wasm = await WebAssembly.instantiate(wasmBuf, go.importObject);
    go.run(wasm.instance);

    await new Promise(r => setTimeout(r, 500));
    if (typeof globalThis.getAdv !== 'function') throw new Error('getAdv not found after WASM boot');
    wasmReady = true;
  })();
  return bootPromise;
}

async function getStream(token, season, episode) {
  const apiUrl = season
    ? `https://vidlink.pro/api/b/tv/${token}/${season}/${episode || 1}?multiLang=0`
    : `https://vidlink.pro/api/b/movie/${token}?multiLang=0`;

  const res = await fetch(apiUrl, {
    headers: { Referer: SCRAPER.referer, Origin: SCRAPER.origin, 'User-Agent': SCRAPER.userAgent },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`vidlink API returned ${res.status}`);
  const data = await res.json();
  if (!data?.stream) return null;
  const { stream } = data;
  const qualities = stream.qualities || {};
  const urls = Object.values(qualities)
    .filter(q => q && q.url)
    .sort((a, b) => Number(b.bitrate) - Number(a.bitrate));
  const direct = urls[urls.length - 1]?.url || null;
  const hls = urls[0]?.hls || stream.hls || null;
  return {
    source: stream.type,
    playlist: hls,
    mp4: direct,
    qualities: Object.fromEntries(
      Object.entries(qualities).filter(([, q]) => q && q.url).map(([label, q]) => [label, q.url])
    ),
    captions: stream.captions || []
  };
}

export function buildAdvToken(imdbId) {
  return String(imdbId);
}

export async function resolveMovieStream(imdbId) {
  await bootWasm();
  const token = globalThis.getAdv(String(imdbId));
  if (!token) throw new Error('getAdv returned null');
  return getStream(token, null, null);
}

export async function resolveTvStream(imdbId, season, episode) {
  await bootWasm();
  const token = globalThis.getAdv(String(imdbId));
  if (!token) throw new Error('getAdv returned null');
  return getStream(token, season || 1, episode || 1);
}