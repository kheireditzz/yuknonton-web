window.Api = (() => {
  async function get(url, signal) {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function post(url, body, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  return {
    home: (signal) => get('/api/home', signal),
    categories: (signal) => get('/api/categories', signal),
    catalog: (cat, page, signal) => get(`/api/catalog?cat=${encodeURIComponent(cat || 'trending')}` + (page ? `&page=${page}` : ''), signal),
    search: (q, signal) => get(`/api/search?q=${encodeURIComponent(q)}`, signal),
    movie: (id, type, signal) => get(`/api/${type === 'tv' ? 'tv' : 'movie'}?id=${encodeURIComponent(id)}`, signal),
    tvSeasons: (id, signal) => get(`/api/tv/seasons?id=${encodeURIComponent(id)}`, signal),
    tvEpisodes: (id, season, signal) => get(`/api/tv/episodes?id=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}`, signal),
    play: (id, type, season, episode, signal) =>
      get(`/api/play?id=${encodeURIComponent(id)}&type=${type || 'movie'}` + (season ? `&season=${season}&episode=${episode}` : ''), signal),
    comments: (id, signal) => get(`/api/comments?id=${encodeURIComponent(id)}`, signal),
    addComment: (id, payload, signal) => post(`/api/comments?id=${encodeURIComponent(id)}`, payload, signal),
    likes: (id, signal) => get(`/api/likes?id=${encodeURIComponent(id)}`, signal),
    like: (id, payload, signal) => post(`/api/likes?id=${encodeURIComponent(id)}`, payload, signal),
    ratings: (id, signal) => get(`/api/ratings?id=${encodeURIComponent(id)}`, signal),
    rate: (id, score, signal) => post(`/api/ratings?id=${encodeURIComponent(id)}`, { score }, signal)
  };
})();