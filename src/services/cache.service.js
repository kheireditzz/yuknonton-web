import { CACHE_TTL_MS } from '../config/constants.js';

const cache = { data: {}, timestamps: {}, ttl: {} };

export function getFromCache(key, ttlMs = CACHE_TTL_MS) {
  const ts = cache.timestamps[key];
  const ttl = cache.ttl[key] || ttlMs;
  if (ts && Date.now() - ts < ttl && cache.data[key]) return cache.data[key];
  return null;
}

export function setCache(key, val, ttlMs = CACHE_TTL_MS) {
  cache.data[key] = val;
  cache.timestamps[key] = Date.now();
  cache.ttl[key] = ttlMs;
}