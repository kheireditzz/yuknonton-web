window.Api = (() => {
  async function get(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    home: () => get('/api/home'),
    categories: () => get('/api/categories'),
    catalog: (cat, page) => get(`/api/catalog?cat=${encodeURIComponent(cat || 'trending')}` + (page ? `&page=${page}` : '')),
    search: (q) => get(`/api/search?q=${encodeURIComponent(q)}`),
    movie: (id, type) => get(`/api/${type === 'tv' ? 'tv' : 'movie'}?id=${encodeURIComponent(id)}`),
    tvSeasons: (id) => get(`/api/tv/seasons?id=${encodeURIComponent(id)}`),
    tvEpisodes: (id, season) => get(`/api/tv/episodes?id=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}`),
    play: (id, type, season, episode) =>
      get(`/api/play?id=${encodeURIComponent(id)}&type=${type || 'movie'}` + (season ? `&season=${season}&episode=${episode}` : '')),
    comments: (id) => get(`/api/comments?id=${encodeURIComponent(id)}`),
    addComment: (id, payload) => post(`/api/comments?id=${encodeURIComponent(id)}`, payload),
    likes: (id) => get(`/api/likes?id=${encodeURIComponent(id)}`),
    like: (id, payload) => post(`/api/likes?id=${encodeURIComponent(id)}`, payload),
    ratings: (id) => get(`/api/ratings?id=${encodeURIComponent(id)}`),
    rate: (id, score) => post(`/api/ratings?id=${encodeURIComponent(id)}`, { score })
  };
})();