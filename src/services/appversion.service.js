const API_URL = 'https://api.github.com/repos/kheireditzz/yuknonton-web/releases/latest';
const WEB_URL = 'https://github.com/kheireditzz/yuknonton-web/releases/latest';
// URL rilis "latest" — selalu menunjuk build APK terbaru karena workflow
// meng-update aset rilis pada tiap push main.
const APK_URL = WEB_URL + '/download/yuknonton-release.apk';
const TTL_MS = 10 * 60 * 1000;

let hit = null;

async function fetchLatest() {
  const res = await fetch(API_URL, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'YukNonton-Web'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const json = await res.json();
  const apk = (json.assets || []).find(a => /\.apk$/i.test(a.name)) || null;
  return {
    version: String(json.tag_name || '').replace(/^v/, ''),
    name: json.name || '',
    publishedAt: json.published_at || '',
    notesUrl: json.html_url || WEB_URL,
    downloadUrl: apk ? apk.browser_download_url : APK_URL,
    fileName: apk ? apk.name : 'yuknonton-release.apk',
    size: apk ? apk.size : 0
  };
}

export async function getAppVersion() {
  if (hit && Date.now() - hit.ts < TTL_MS) return { ...hit.value, cached: true };
  try {
    const value = await fetchLatest();
    hit = { ts: Date.now(), value };
    return { ...value, cached: false };
  } catch (err) {
    if (hit) return { ...hit.value, cached: true, stale: true };
    return {
      version: '1.0.0',
      name: 'YukNonton',
      publishedAt: '',
      notesUrl: WEB_URL,
      downloadUrl: APK_URL,
      fileName: 'yuknonton-release.apk',
      size: 0,
      cached: false,
      error: err.message
    };
  }
}
