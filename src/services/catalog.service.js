import { CATALOG, CATALOG_BY_ID, ROWS } from '../config/constants.js';
import { scrapeCatalog } from './tmdb.service.js';

const cache = new Map();
const rowsCache = new Map();

export function listCategories() {
  return CATALOG.map(c => ({
    id: c.id,
    label: c.label,
    icon: c.icon,
    realtime: !!c.realtime
  }));
}

export function getCategory(id) {
  return CATALOG_BY_ID[id] || null;
}

export async function getCatalog(id, page = 1) {
  const cat = getCategory(id) || CATALOG_BY_ID.trending;
  return loadCategory(cat, page);
}

async function loadCategory(cat, page = 1) {
  const key = cat.id + ':p' + page;
  const hit = cache.get(key);
  const ttl = (cat.ttl || 600) * 1000;
  if (hit && Date.now() - hit.ts < ttl) {
    return { ...hit.value, cached: true, category: cat.id, realtime: !!cat.realtime };
  }

  const paths = cat.paths.map(p => addPage(p, page));
  let items = await scrapeCatalog(paths).catch(() => []);

  const value = { category: cat.id, label: cat.label, page, cards: items };
  cache.set(key, { ts: Date.now(), value });
  return { ...value, cached: false, realtime: !!cat.realtime };
}

function addPage(path, page) {
  if (!page || page <= 1) return path;
  return path + (path.includes('?') ? '&' : '?') + 'page=' + page;
}

// ── Home rows: baris campuran (rekomendasi/trending/favorit/lain-lain) ────
export function listRows() {
  return ROWS.map(r => ({ id: r.id, label: r.label, icon: r.icon }));
}

export async function getRows() {
  const hit = rowsCache.get('all');
  if (hit && Date.now() - hit.ts < 5 * 60 * 1000) {
    return { cached: true, rows: hit.value };
  }

  const rows = await Promise.all(ROWS.map(async row => {
    const lists = await Promise.all(
      row.cats.map(id => getCatalog(id, 1).then(r => r.cards || []).catch(() => []))
    );
    const cards = mix(listOfLists(lists)).slice(0, row.limit);
    return { id: row.id, label: row.label, icon: row.icon, cards };
  }));

  const value = rows.filter(r => r.cards.length);
  rowsCache.set('all', { ts: Date.now(), value });
  return { cached: false, rows: value };
}

// Ambil N kartu pertama tiap sumber sebagai kolam untuk dicampur, agar tiap
// sumber terwakili merata dan tidak didominasi satu kategori.
function listOfLists(lists, per = 12) {
  return lists.map(list => list.slice(0, per));
}

// Round-robin antar sumber + acak urutan dalam blok agar "campuran".
function mix(lists) {
  const pools = lists.filter(l => l && l.length);
  const seen = new Set();
  const out = [];
  let more = true;
  let round = 0;
  while (more && round < 40) {
    more = false;
    // Urutan putaran diacak sekali saja agar bervariasi tiap muat
    const order = pools.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of order) {
      const p = pools[i];
      if (round >= p.length) continue;
      more = true;
      const item = p[round];
      const key = (item.type || '') + item.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    round++;
  }
  return out;
}