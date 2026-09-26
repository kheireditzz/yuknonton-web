import { resolveMovieStream, resolveTvStream } from './vidlink.service.js';
import { scrapeMovieDetail } from './tmdb.service.js';

export async function resolveMediaStream(id, type = 'movie', season, episode) {
  if (type === 'tv') {
    return { playlist: await resolveTvStream(String(id), season, episode), type: 'tv', season, episode };
  }
  const playlist = await resolveMovieStream(String(id));
  return { playlist, type: 'movie' };
}

// Build a "play" payload combining details + verified streams
export async function buildPlayPayload(id, type = 'movie', season, episode) {
  const [detail, stream] = await Promise.all([
    type === 'movie' ? scrapeMovieDetail(id).catch(() => null) : Promise.resolve(null),
    resolveMediaStream(id, type, season, episode).catch(() => null)
  ]);
  return { id, type, detail, stream };
}