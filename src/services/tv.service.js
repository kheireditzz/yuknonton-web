import { TV_PLAYLISTS, FOOTBALL_RE } from '../config/constants.js';

const TTL_MS = 30 * 60 * 1000;
const store = new Map();

function attr(line, name) {
  const m = line.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : '';
}

function parseM3u(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  let pending = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const name = comma >= 0 ? line.slice(comma + 1).trim() : '';
      pending = {
        name,
        logo: attr(line, 'tvg-logo'),
        group: attr(line, 'group-title'),
        id: attr(line, 'tvg-id')
      };
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!pending) continue;
    if (/^https?:\/\//i.test(line)) {
      out.push({ ...pending, url: line, https: line.toLowerCase().startsWith('https://') });
    }
    pending = null;
  }
  return out;
}

function cleanName(n) {
  return String(n || '')
    .replace(/[[(](\d+p|HD|SD|FHD|4K|geo[- ]?blocked)[)\]]\s*/gi, ' ')
    .replace(/\b(\d{3,4}p)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pickQuality(name) {
  const m = String(name || '').match(/(2160|1080|720|480)p/i);
  return m ? m[1] + 'p' : '';
}

function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const ch of list) {
    if (/geo[- ]?blocked/i.test(ch.name)) continue;
    const name = cleanName(ch.name);
    if (!name || !ch.url) continue;
    const key = name.toLowerCase() + '|' + ch.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const payload = { u: ch.url, n: name, g: ch.group || '', l: ch.logo || '', q: pickQuality(ch.name) };
    out.push({
      id: 'tv:' + Buffer.from(JSON.stringify(payload)).toString('base64url'),
      name,
      logo: ch.logo || '',
      group: ch.group || '',
      quality: pickQuality(ch.name),
      football: FOOTBALL_RE.test(name + ' ' + (ch.group || '')),
      https: !!ch.https,
      url: ch.url
    });
  }
  // https (aman dari mixed-content) lebih dulu, lalu nama alfabet.
  out.sort((a, b) => (b.https - a.https) || a.name.localeCompare(b.name));
  return out;
}

async function fetchPlaylist(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (YukNonton TV)' },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error(`m3u HTTP ${res.status}`);
  return res.text();
}

async function loadCategory(cat) {
  const conf = TV_PLAYLISTS[cat];
  if (!conf) return null;
  const hit = store.get(cat);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit;

  const lists = await Promise.all(conf.urls.map(u => fetchPlaylist(u).then(parseM3u).catch(() => [])));
  const channels = normalize(lists.flat());
  const entry = { ts: Date.now(), label: conf.label, channels, httpsCount: channels.filter(c => c.https).length };
  store.set(cat, entry);
  return entry;
}

export function listTvCategories() {
  return Object.entries(TV_PLAYLISTS).map(([id, c]) => ({ id, label: c.label }));
}

export async function getTvChannels(cat = 'sports', opts = {}) {
  const entry = await loadCategory(cat);
  if (!entry) return { category: cat, label: cat, count: 0, data: [] };
  let channels = entry.channels;
  if (opts.football) channels = channels.filter(c => c.football);
  if (opts.secure) channels = channels.filter(c => c.https);
  if (opts.q) {
    const q = String(opts.q).toLowerCase();
    channels = channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }
  const limit = Math.min(Number(opts.limit) || 120, 400);
  return {
    category: cat,
    label: entry.label,
    count: channels.length,
    fetchedAt: entry.ts,
    data: channels.slice(0, limit)
  };
}
