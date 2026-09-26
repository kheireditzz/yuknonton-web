import { CACHE_TTL_MS } from '../config/constants.js';

const cache = { data: {}, timestamps: {} };

export function getFromCache(key) {
  const ts = cache.timestamps[key];
  if (ts && Date.now() - ts < CACHE_TTL_MS && cache.data[key]) return cache.data[key];
  return null;
}

export function setCache(key, val) {
  cache.data[key] = val;
  cache.timestamps[key] = Date.now();
}