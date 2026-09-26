import { CATALOG, CATALOG_BY_ID } from '../config/constants.js';
import { scrapeCatalog } from './tmdb.service.js';

const cache = new Map();

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