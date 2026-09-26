import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'interactions.json');

let db = { comments: {}, likes: {}, ratings: {} };
let writeTimer = null;

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      db.comments = parsed.comments || {};
      db.likes = parsed.likes || {};
      db.ratings = parsed.ratings || {};
    }
  } catch (err) {
    console.error('[interactions] gagal memuat DB:', err.message);
  }
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
      console.error('[interactions] gagal menyimpan DB:', err.message);
    }
  }, 120);
}

load();

function key(id) {
  return String(id || 'unknown');
}

function sanitize(text, max = 600) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function getComments(mediaId) {
  const list = db.comments[key(mediaId)] || [];
  return {
    count: list.length,
    data: list.slice().sort((a, b) => b.createdAt - a.createdAt)
  };
}

export function addComment(mediaId, { name, text }) {
  const cleanText = sanitize(text);
  if (!cleanText) {
    const err = new Error('Komentar tidak boleh kosong');
    err.status = 400;
    throw err;
  }
  const comment = {
    id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: sanitize(name, 40) || 'Pengguna Anonim',
    text: cleanText,
    likes: 0,
    createdAt: Date.now()
  };
  const k = key(mediaId);
  if (!db.comments[k]) db.comments[k] = [];
  db.comments[k].push(comment);
  persist();
  return comment;
}

export function getLikes(mediaId) {
  const rec = db.likes[key(mediaId)] || { likes: 0, dislikes: 0 };
  return { likes: rec.likes || 0, dislikes: rec.dislikes || 0 };
}

export function applyLikeDelta(mediaId, likeDelta, dislikeDelta) {
  const k = key(mediaId);
  const rec = db.likes[k] || { likes: 0, dislikes: 0 };
  rec.likes = Math.max(0, (rec.likes || 0) + (Number(likeDelta) || 0));
  rec.dislikes = Math.max(0, (rec.dislikes || 0) + (Number(dislikeDelta) || 0));
  db.likes[k] = rec;
  persist();
  return { likes: rec.likes, dislikes: rec.dislikes };
}

// ── Rating Poll (1–5 bintang) ────────────────────────────────────────────
// rec = { counts: {1:..,5:..}, total, sum }
export function getRating(mediaId) {
  const rec = db.ratings[key(mediaId)] || { counts: {}, total: 0, sum: 0 };
  const total = rec.total || 0;
  const average = total ? Math.round((rec.sum / total) * 10) / 10 : 0;
  const counts = {};
  for (let s = 1; s <= 5; s++) counts[s] = (rec.counts && rec.counts[s]) || 0;
  const distribution = Object.fromEntries(
    Object.entries(counts).map(([s, c]) => [s, total ? Math.round((c / total) * 100) : 0])
  );
  return { average, total, counts, distribution };
}

export function applyRating(mediaId, score) {
  const s = Math.round(Number(score));
  if (!s || s < 1 || s > 5) {
    const err = new Error('Nilai rating harus 1 sampai 5');
    err.status = 400;
    throw err;
  }
  const k = key(mediaId);
  const rec = db.ratings[k] || { counts: {}, total: 0, sum: 0 };
  rec.counts[s] = (rec.counts[s] || 0) + 1;
  rec.total = (rec.total || 0) + 1;
  rec.sum = (rec.sum || 0) + s;
  db.ratings[k] = rec;
  persist();
  return getRating(mediaId);
}