(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let currentView = 'home';
  let currentDetail = null;
  let hls = null;

  let categories = [];
  let activeCategory = 'trending';
  let realtimeTimer = null;
  const catalogState = { page: 1, hasMore: true, loading: false };
  let seenKeys = new Set();

  const watchState = {
    id: null,
    type: 'movie',
    season: null,
    episode: null,
    title: '',
    detail: null,
    stream: null,
    qualities: {},
    qualityKey: null,
    likes: { likes: 0, dislikes: 0 },
    myVote: 0,
    rating: null,
    myRating: 0
  };

  // ── Race guard: token + abort per alur agar respons lama tidak menimpa UI baru ──
  let watchSession = 0;
  let watchAbort = null;
  let detailReq = 0;
  let detailAbort = null;
  let episodeReq = 0;
  let searchReq = 0;
  let searchAbort = null;
  let catalogReq = 0;
  let catalogAbort = null;

  // ── Route & State Persistence (URL Hash + LocalStorage) ────
  const ROUTE_STORAGE_KEY = 'yn_last_route_v2';
  let isApplyingRoute = false;

  function serializeRoute(route) {
    if (!route || route.view === 'home') {
      if (route && route.category && route.category !== 'trending') {
        return `#/category/${encodeURIComponent(route.category)}`;
      }
      return '#/';
    }
    if (route.view === 'watch') {
      const params = new URLSearchParams();
      if (route.id) params.set('id', route.id);
      if (route.type) params.set('type', route.type);
      if (route.season) params.set('s', route.season);
      if (route.episode) params.set('ep', route.episode);
      if (route.title) params.set('title', route.title);
      return `#/watch?${params.toString()}`;
    }
    if (route.view === 'search') {
      const q = route.query || '';
      return q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
    }
    if (route.view === 'detail') {
      const params = new URLSearchParams();
      if (route.id) params.set('id', route.id);
      if (route.type) params.set('type', route.type);
      if (route.title) params.set('title', route.title);
      return `#/detail?${params.toString()}`;
    }
    return '#/';
  }

  function parseHash(hashStr) {
    const raw = String(hashStr || '').replace(/^#\/?/, '').trim();
    if (!raw) return null;

    if (raw.startsWith('category/')) {
      const cat = decodeURIComponent(raw.replace('category/', ''));
      return { view: 'home', category: cat };
    }

    const qIdx = raw.indexOf('?');
    const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const search = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
    const params = new URLSearchParams(search);

    if (path === 'watch') {
      const id = params.get('id');
      if (!id) return null;
      return {
        view: 'watch',
        id,
        type: params.get('type') || 'movie',
        season: params.get('s') ? Number(params.get('s')) : null,
        episode: params.get('ep') ? Number(params.get('ep')) : null,
        title: params.get('title') || ''
      };
    }
    if (path === 'search') {
      return {
        view: 'search',
        query: params.get('q') || ''
      };
    }
    if (path === 'detail') {
      const id = params.get('id');
      if (!id) return null;
      return {
        view: 'detail',
        id,
        type: params.get('type') || 'movie',
        title: params.get('title') || ''
      };
    }
    return null;
  }

  function getCurrentRoute() {
    const fromHash = parseHash(window.location.hash);
    if (fromHash) return fromHash;

    try {
      const stored = localStorage.getItem(ROUTE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}

    return { view: 'home', category: 'trending' };
  }

  function setRoute(route, replace = false) {
    if (isApplyingRoute) return;
    try {
      localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
    } catch (e) {}

    const newHash = serializeRoute(route);
    if (window.location.hash !== newHash) {
      isApplyingRoute = true;
      if (replace) {
        history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
      } else {
        window.location.hash = newHash;
      }
      setTimeout(() => { isApplyingRoute = false; }, 60);
    }
  }

  function applyRoute(route) {
    if (!route) route = { view: 'home', category: activeCategory };
    if (route.view === 'watch' && route.id) {
      const sameWatch = String(watchState.id) === String(route.id) &&
        Number(watchState.episode || 1) === Number(route.episode || 1) &&
        Number(watchState.season || 1) === Number(route.season || 1) &&
        currentView === 'watch';
      if (!sameWatch) {
        playStream(route.id, route.type, route.season, route.episode, route.title);
      }
      return;
    }

    if (route.view === 'search') {
      if (currentView === 'watch') closePlayer();
      openFullSearch(route.query || '');
      return;
    }

    if (route.view === 'detail' && route.id) {
      if (currentView === 'watch') closePlayer();
      openDetail(route.id, route.title, route.type);
      return;
    }

    // Default: home view
    const overlay = $('#fullSearchOverlay');
    if (overlay && overlay.style.display !== 'none') closeFullSearch();
    if (currentView === 'watch') closePlayer();
    if (route.category && route.category !== activeCategory) {
      selectCategory(route.category);
    }
    if (currentView !== 'home') showView('home');
  }

  function newAbortController() {
    return typeof AbortController !== 'undefined' ? new AbortController() : null;
  }
  function signalOf(ctrl) {
    return ctrl ? ctrl.signal : undefined;
  }
  function isAbort(err) {
    return !!err && err.name === 'AbortError';
  }

  // Mulai sesi putar baru: batalkan request sesi sebelumnya, kembalikan token sesi.
  function beginWatchSession() {
    watchSession++;
    if (watchAbort) { try { watchAbort.abort(); } catch (e) {} }
    watchAbort = newAbortController();
    return { token: watchSession, signal: signalOf(watchAbort) };
  }
  function isWatchActive(token) {
    return token === watchSession;
  }
  // Tinggalkan watch view: batalkan semua request yang masih berjalan.
  function abortWatchSession() {
    watchSession++;
    if (watchAbort) { try { watchAbort.abort(); } catch (e) {} }
    watchAbort = null;
  }

  // Prefetch sumber stream agar tombol putar langsung siap (server meng-cache hasilnya).
  const prefetched = new Set();
  function prefetchStream(id, type, season, episode) {
    if (!id) return;
    const key = (type || 'movie') + id + (season ? ':' + season + ':' + (episode || 1) : '');
    if (prefetched.has(key)) return;
    prefetched.add(key);
    Api.prefetchPlay(id, type, season, episode);
  }

  // ── Icon System (SVG stroke, no emoji) ───────────────────
  const ICON_PATHS = {
    trending: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>',
    broadcast: '<circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path>',
    signal: '<path d="M2 20h.01"></path><path d="M7 20v-4"></path><path d="M12 20v-8"></path><path d="M17 20V8"></path><path d="M22 4v16"></path>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"></path><path d="M5 3v4M3 5h4M19 17v4M17 19h4"></path>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line>',
    globe: '<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>',
    tv: '<rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline>',
    award: '<circle cx="12" cy="8" r="6"></circle><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"></path>',
    palette: '<circle cx="13.5" cy="6.5" r="1.5"></circle><circle cx="17.5" cy="10.5" r="1.5"></circle><circle cx="8.5" cy="7.5" r="1.5"></circle><circle cx="6.5" cy="12.5" r="1.5"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path>',
    masks: '<path d="M2 10s3-3 3-3 3 3 3 3"></path><path d="M2 10v4a4 4 0 0 0 8 0v-4"></path><path d="M16 10s3-3 3-3 3 3 3 3"></path><path d="M14 10v4a4 4 0 0 0 8 0v-4"></path>',
    ghost: '<path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"></path>',
    smile: '<circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
    compass: '<circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>',
    search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>',
    target: '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>',
    wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"></path>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"></path><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"></path>',
    alert: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
    info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
    'alert-triangle': '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    close: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    'message': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"></polyline>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    loader: '<line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>'
  };

  function icon(name, size = 16, strokeWidth = 2.2) {
    const path = ICON_PATHS[name];
    if (!path) return '';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  // ── Global loading bar (pengganti notifikasi) ────────────
  let loadingCount = 0;
  function beginLoading() {
    loadingCount++;
    $('#loadingBar')?.classList.add('active');
  }
  function endLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount === 0) $('#loadingBar')?.classList.remove('active');
  }

  // ── Inline note (info/error) — bukan notifikasi melayang ──
  function inlineNote(target, kind, message, extraHtml = '') {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    const kindIcon = kind === 'error' ? 'alert-triangle' : kind === 'empty' ? 'info' : 'info';
    el.className = 'inline-note ' + kind;
    el.innerHTML = `<div class="inline-note-icon">${icon(kindIcon, 18, 2.2)}</div>
      <div class="inline-note-body"><p class="inline-note-text">${escapeHtml(message)}</p>${extraHtml}</div>`;
  }

  function renderLoading(target, message) {
    const el = typeof target === 'string' ? $(target) : target;
    if (!el) return;
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.gridColumn = '1 / -1';
    wrap.className = 'inline-note loading';
    wrap.innerHTML = `<div class="inline-note-icon spin">${icon('loader', 18, 2.2)}</div>
      <div class="inline-note-body"><p class="inline-note-text">${escapeHtml(message)}</p></div>`;
    el.appendChild(wrap);
  }

  // Buat note sebagai anak container (aman untuk grid) agar class container tidak tertimpa
  function noteInto(container, kind, message, extraHtml = '') {
    const host = typeof container === 'string' ? $(container) : container;
    if (!host) return null;
    const wrap = document.createElement('div');
    wrap.style.gridColumn = '1 / -1';
    wrap.style.marginTop = '8px';
    inlineNote(wrap, kind, message, extraHtml);
    host.innerHTML = '';
    host.appendChild(wrap);
    return wrap;
  }

  function appendNote(container, kind, message, extraHtml = '') {
    const host = typeof container === 'string' ? $(container) : container;
    if (!host) return null;
    const wrap = document.createElement('div');
    wrap.style.gridColumn = '1 / -1';
    wrap.style.marginTop = '8px';
    inlineNote(wrap, kind, message, extraHtml);
    host.appendChild(wrap);
    return wrap;
  }

  let returnView = 'home';
  function showView(name) {
    // Keluar dari watch view → batalkan request stream yang masih berjalan
    if (currentView === 'watch' && name !== 'watch') abortWatchSession();
    if (name === 'watch' && currentView !== 'watch') {
      returnView = (currentView === 'detail' || !currentView) ? 'home' : currentView;
    }
    currentView = name;
    $('#homeView').style.display = name === 'home' ? '' : 'none';
    $('#detailView').classList.toggle('visible', name === 'detail');
    $('#searchView').classList.toggle('visible', name === 'search');
    $('#watchView').classList.toggle('visible', name === 'watch');
    document.body.classList.toggle('watch-mode', name === 'watch');
    if (name === 'home') {
      $('#headerLogo').style.pointerEvents = 'none';
    } else {
      $('#headerLogo').style.pointerEvents = 'auto';
      stopRealtime();
    }
    window.scrollTo({ top: 0, behavior: name === 'watch' ? 'auto' : 'smooth' });
  }

  // ── Card Render ──────────────────────────────────────────
  function posterUrl(p) {
    if (!p) return '';
    return p.startsWith('http') ? p : 'https://media.themoviedb.org/t/p/w220_and_h330_face' + p;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderMovieCard(item) {
    const el = document.createElement('div');
    el.className = 'movie-card';
    const title = item.name || item.title || '';
    const isAnichin = item.provider === 'anichin' || item.type === 'anichin' || String(item.id).startsWith('anichin:');
    const badgeTypeHtml = isAnichin
      ? `<span class="movie-type-badge anichin">${icon('sparkles', 11, 2)} ${escapeHtml(item.badge || 'Donghua')}</span>`
      : `<span class="movie-type-badge">${icon(item.type === 'tv' ? 'tv' : 'film', 13, 2.3)}</span>`;
    const metaSub = isAnichin
      ? (item.badge || 'Donghua Sub Indo')
      : (item.type === 'tv' ? 'Serial' : 'Film');

    el.innerHTML = `
      <div class="movie-poster-wrap">
        ${item.rating ? `<span class="movie-rating">${icon('star', 11, 2)} ${Number(item.rating).toFixed(1)}</span>` : ''}
        ${badgeTypeHtml}
        <img class="movie-poster" loading="lazy" decoding="async"
             src="${posterUrl(item.poster || item.poster_path)}"
             alt="${escapeHtml(title)}"
             referrerpolicy="no-referrer"
             onerror="this.onerror=null;this.src='/img/no-poster.svg'">
        <div class="movie-play-overlay"><div class="pbtn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </div></div>
      </div>
      <div class="movie-title">${escapeHtml(title)}</div>
      <div class="movie-meta">
        <span>${escapeHtml(item.release ? String(item.release).slice(0, 4) : '—')}</span>
        <span class="dot"></span>
        <span>${escapeHtml(metaSub)}</span>
      </div>
    `;
    el.addEventListener('click', () => {
      const targetType = isAnichin ? 'anichin' : (item.type || 'movie');
      if (targetType === 'tv' || targetType === 'anichin') {
        playStream(item.id, targetType, 1, 1, title);
      } else {
        playStream(item.id, 'movie', null, null, title);
      }
    });
    return el;
  }

  // ── Skeleton ─────────────────────────────────────────────
  function renderSkeleton(count = 10) {
    const grid = $('#moviesGrid');
    grid.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'skeleton-card';
      c.innerHTML = `<div class="skeleton-shimmer-box skeleton-poster"></div>
        <div class="skeleton-shimmer-box" style="height:14px;border-radius:6px;width:85%;margin-top:8px"></div>
        <div class="skeleton-shimmer-box" style="height:10px;border-radius:5px;width:50%;margin-top:7px"></div>`;
      grid.appendChild(c);
    }
  }

  // ── Categories ───────────────────────────────────────────
  async function loadCategories() {
    beginLoading();
    try {
      const res = await Api.categories();
      categories = res.data || [];
      renderCategoryTabs();
    } catch (err) {
      categories = [{ id: 'trending', label: 'Trending', icon: 'trending', realtime: false }];
      renderCategoryTabs();
    } finally {
      endLoading();
    }
  }

  function renderCategoryTabs() {
    const box = $('#filterTabs');
    box.innerHTML = '';
    categories.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'neu-tab-btn' + (c.id === activeCategory ? ' active' : '');
      b.dataset.cat = c.id;
      b.innerHTML = `<span class="tab-ico">${icon(c.icon || 'film', 14, 2.3)}</span><span class="tab-label">${escapeHtml(c.label)}</span>`;
      b.addEventListener('click', () => selectCategory(c.id));
      box.appendChild(b);
    });
  }

  function selectCategory(catId) {
    if (activeCategory === catId) return;
    activeCategory = catId;
    setRoute({ view: 'home', category: catId });
    $$('#filterTabs .neu-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === catId));
    loadCatalog(catId);
  }

  async function loadCatalog(catId) {
    renderSkeleton(10);
    stopRealtime();
    if (catalogAbort) { try { catalogAbort.abort(); } catch (e) {} }
    catalogAbort = newAbortController();
    const token = ++catalogReq;
    catalogState.page = 1;
    catalogState.hasMore = true;
    seenKeys = new Set();
    beginLoading();
    try {
      const res = await Api.catalog(catId, 1, signalOf(catalogAbort));
      if (token !== catalogReq) return;
      const movies = res.data || [];
      const cat = categories.find(c => c.id === catId) || {};
      $('#sectionLabel').textContent = res.label || cat.label || 'Daftar';
      $('#liveBadge').style.display = res.realtime ? 'inline-flex' : 'none';

      const grid = $('#moviesGrid');
      grid.innerHTML = '';
      movies.forEach(m => appendCard(grid, m));
      $('#sectionCount').textContent = seenKeys.size + ' judul';
      if (movies.length === 0) {
        noteInto(grid, 'empty', 'Belum ada judul pada kategori ini. Coba pilih kategori lain atau muat ulang halaman.');
      }
      catalogState.hasMore = movies.length > 0;

      if (res.realtime) startRealtime(catId);
    } catch (err) {
      if (isAbort(err) || token !== catalogReq) return;
      console.error(err);
      const grid = $('#moviesGrid');
      noteInto(grid, 'error', 'Gagal memuat katalog. Periksa koneksi internet lalu coba lagi.',
        `<button type="button" class="tactile-btn retry-btn" id="catalogRetry">Coba Lagi</button>`);
      $('#catalogRetry')?.addEventListener('click', () => loadCatalog(catId));
    } finally {
      endLoading();
    }
    if (token === catalogReq) updateLoadMore();
  }

  function appendCard(grid, m) {
    const key = (m.type || '') + m.id;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    grid.appendChild(renderMovieCard(m));
  }

  async function loadMore() {
    if (catalogState.loading || !catalogState.hasMore) return;
    catalogState.loading = true;
    const token = catalogReq;
    const btn = $('#loadMoreBtn');
    const label = $('#loadMoreLabel');
    const prev = label.textContent;
    btn.classList.add('loading');
    label.textContent = 'Memuat...';
    const next = catalogState.page + 1;
    try {
      const res = await Api.catalog(activeCategory, next, signalOf(catalogAbort));
      if (token !== catalogReq) return;
      const movies = res.data || [];
      const grid = $('#moviesGrid');
      const before = seenKeys.size;
      movies.forEach(m => appendCard(grid, m));
      const added = seenKeys.size - before;
      catalogState.page = next;
      $('#sectionCount').textContent = seenKeys.size + ' judul';
      if (movies.length === 0 || added === 0) {
        catalogState.hasMore = false;
      }
    } catch (err) {
      if (isAbort(err) || token !== catalogReq) return;
      console.error(err);
      appendNote('#moviesGrid', 'error', 'Gagal memuat halaman berikutnya. Periksa koneksi lalu coba lagi.');
    } finally {
      if (token === catalogReq) {
        catalogState.loading = false;
        btn.classList.remove('loading');
        label.textContent = prev;
        updateLoadMore();
      }
    }
  }

  function updateLoadMore() {
    $('#loadMoreWrap').style.display = catalogState.hasMore ? 'flex' : 'none';
  }

  // ── Realtime auto-update ─────────────────────────────────
  function startRealtime(catId) {
    stopRealtime();
    realtimeTimer = setInterval(async () => {
      if (currentView !== 'home' || activeCategory !== catId) return stopRealtime();
      try {
        const res = await Api.catalog(catId, 1);
        const movies = res.data || [];
        const grid = $('#moviesGrid');
        grid.innerHTML = '';
        seenKeys = new Set();
        movies.forEach(m => appendCard(grid, m));
        catalogState.page = 1;
        catalogState.hasMore = movies.length > 0;
        updateLoadMore();
        $('#sectionCount').textContent = seenKeys.size + ' judul';
      } catch (e) {}
    }, 60000);
  }

  function stopRealtime() {
    if (realtimeTimer) { clearInterval(realtimeTimer); realtimeTimer = null; }
  }

  // ── Home load ────────────────────────────────────────────
  async function loadHome() {
    await loadCategories();
    await loadCatalog(activeCategory);
    loadBanner();
    initAdCarousel();
    loadRows();
  }

  // ── Baris campuran (rekomendasi/trending/favorit/lain-lain) ──
  async function loadRows() {
    const host = $('#homeRows');
    if (!host) return;
    host.innerHTML = '';
    try {
      const res = await Api.rows();
      renderHomeRows(res.data || []);
    } catch (e) {
      renderHomeRows([]);
    }
  }

  function renderHomeRows(rows) {
    const host = $('#homeRows');
    if (!host) return;
    host.innerHTML = '';
    if (!rows.length) return;
    rows.forEach(row => host.appendChild(renderHomeRow(row)));
  }

  function renderHomeRow(row) {
    const section = document.createElement('section');
    section.className = 'home-row';
    section.innerHTML = `
      <div class="home-row-head">
        <div class="home-row-title">
          <span class="home-row-ico">${icon(row.icon || 'film', 15, 2.3)}</span>
          <span>${escapeHtml(row.label)}</span>
        </div>
        <span class="home-row-count">${row.cards.length} judul</span>
      </div>
      <div class="home-row-strip"></div>
    `;
    const strip = section.querySelector('.home-row-strip');
    row.cards.forEach(c => strip.appendChild(renderRowCard(c)));
    return section;
  }

  function renderRowCard(item) {
    const el = document.createElement('div');
    el.className = 'row-card';
    const title = item.name || item.title || '';
    const isAnichin = item.provider === 'anichin' || item.type === 'anichin' || String(item.id).startsWith('anichin:');
    const typeLabel = isAnichin ? 'Donghua' : (item.type === 'tv' ? 'Serial' : 'Film');
    const typeIco = isAnichin ? 'sparkles' : (item.type === 'tv' ? 'tv' : 'film');
    el.innerHTML = `
      <div class="row-card-poster">
        <img loading="lazy" decoding="async" src="${posterUrl(item.poster || item.poster_path)}"
             alt="${escapeHtml(title)}" referrerpolicy="no-referrer"
             onerror="this.onerror=null;this.src='/img/no-poster.svg'">
        <span class="row-card-type">${icon(typeIco, 12, 2.3)}</span>
        <span class="row-card-play"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></span>
      </div>
      <div class="row-card-title">${escapeHtml(title)}</div>
      <div class="row-card-sub">${escapeHtml(item.release ? String(item.release).slice(0, 4) : '—')} · ${escapeHtml(typeLabel)}</div>
    `;
    el.addEventListener('click', () => {
      const targetType = isAnichin ? 'anichin' : (item.type || 'movie');
      if (targetType === 'tv' || targetType === 'anichin') {
        playStream(item.id, targetType, 1, 1, title);
      } else {
        playStream(item.id, 'movie', null, null, title);
      }
    });
    return el;
  }

  // ── Auto-slider generik (dot + geser sendiri + pause saat disentuh) ──
  function setupAutoSlider(track, dotsHost, opts = {}) {
    if (!track || !dotsHost) return null;
    if (track.__slider && typeof track.__slider.destroy === 'function') track.__slider.destroy();
    const slides = Array.from(track.children);
    if (!slides.length) return null;

    const dotClass = opts.dotClass || 'ad-carousel-dot';
    const interval = opts.interval || 5200;
    const loop = opts.loop !== false;
    dotsHost.innerHTML = '';
    const dots = slides.map((_, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = dotClass + (i === 0 ? ' active' : '');
      d.setAttribute('aria-label', 'Slide ' + (i + 1));
      d.addEventListener('click', () => { goTo(i); restart(); });
      dotsHost.appendChild(d);
      return d;
    });

    let idx = 0;
    let timer = null;
    let scrollGuard = null;
    const handlers = [];

    function setActive(i) {
      idx = i;
      dots.forEach((d, k) => d.classList.toggle('active', k === i));
    }
    function goTo(i, smooth = true) {
      if (!slides.length) return;
      if (!loop) i = Math.max(0, Math.min(slides.length - 1, i));
      else i = (i + slides.length) % slides.length;
      setActive(i);
      const target = slides[i];
      track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    }
    function restart() {
      if (timer) clearInterval(timer);
      if (slides.length < 2) return;
      timer = setInterval(() => {
        if (document.hidden || currentView !== 'home') return;
        if (track.dataset.paused === '1') return;
        goTo(idx + 1);
      }, interval);
    }

    const onScroll = () => {
      clearTimeout(scrollGuard);
      scrollGuard = setTimeout(() => {
        const center = track.scrollLeft + track.clientWidth / 2;
        let best = 0, bestDist = Infinity;
        slides.forEach((s, i) => {
          const c = s.offsetLeft - track.offsetLeft + s.offsetWidth / 2;
          const dd = Math.abs(c - center);
          if (dd < bestDist) { bestDist = dd; best = i; }
        });
        setActive(best);
      }, 90);
    };
    const pause = () => { track.dataset.paused = '1'; };
    const resume = () => { track.dataset.paused = '0'; restart(); };

    track.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerdown', pause, { passive: true });
    track.addEventListener('touchstart', pause, { passive: true });
    track.addEventListener('pointerup', resume, { passive: true });
    track.addEventListener('touchend', resume, { passive: true });
    track.addEventListener('touchcancel', resume, { passive: true });
    track.addEventListener('mouseenter', pause);
    track.addEventListener('mouseleave', resume);
    handlers.push(
      ['scroll', onScroll], ['pointerdown', pause], ['touchstart', pause],
      ['pointerup', resume], ['touchend', resume], ['touchcancel', resume],
      ['mouseenter', pause], ['mouseleave', resume]
    );

    restart();
    const api = {
      goTo,
      restart,
      destroy() {
        if (timer) clearInterval(timer);
        clearTimeout(scrollGuard);
        handlers.forEach(([ev, fn]) => track.removeEventListener(ev, fn));
        track.__slider = null;
      }
    };
    track.__slider = api;
    return api;
  }

  // ── Carousel banner info (lapor bug + PlayMusic) ─────────
  function initAdCarousel() {
    setupAutoSlider($('#adCarouselTrack'), $('#adCarouselDots'), {
      dotClass: 'ad-carousel-dot',
      interval: 5600
    });
  }

  async function loadBanner() {
    try {
      const res = await Api.catalog('trending', 1);
      renderBanner((res.data || []).slice(0, 8));
    } catch (e) {}
  }

  // ── Banner ───────────────────────────────────────────────
  function renderBanner(items) {
    const strip = $('#bannerStrip');
    const dots = $('#bannerDots');
    strip.innerHTML = '';
    dots.innerHTML = '';

    items.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'banner-card';
      const title = m.name || m.title;
      const kind = m.type === 'tv' ? 'Serial' : 'Film';
      card.innerHTML = `
        <img class="banner-bg" loading="lazy" src="${posterUrl(m.poster)}" alt="${escapeHtml(title)}"
             referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/img/no-poster.svg'">
        <span class="banner-shine" aria-hidden="true"></span>
        <div class="banner-play-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </div>
        <div class="banner-overlay">
          <span class="banner-tag">
            ${icon('flame', 12, 2.4)}
            ${i === 0 ? 'Pilihan Tim' : 'Trending'}
          </span>
          <div class="banner-title">${escapeHtml(title)}</div>
          <div class="banner-meta">
            ${m.release ? `<span class="banner-meta-item">${icon('calendar', 12, 2.3)} ${escapeHtml(m.release)}</span>` : ''}
            <span class="banner-meta-item">${icon(m.type === 'tv' ? 'tv' : 'film', 12, 2.3)} ${kind}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => {
        const isAnichin = m.provider === 'anichin' || m.type === 'anichin' || String(m.id).startsWith('anichin:');
        const targetType = isAnichin ? 'anichin' : (m.type || 'movie');
        if (targetType === 'tv' || targetType === 'anichin') {
          playStream(m.id, targetType, 1, 1, title);
        } else {
          playStream(m.id, 'movie', null, null, title);
        }
      });
      strip.appendChild(card);
    });

    setupAutoSlider(strip, dots, { dotClass: 'banner-dot', interval: 4600 });
  }

  // ── Detail ───────────────────────────────────────────────
  let detailEpisodes = [];
  let detailSeasons = [];
  let detailSelectedSeason = 1;

  async function openDetail(id, fallbackTitle, type) {
    if (detailAbort) { try { detailAbort.abort(); } catch (e) {} }
    detailAbort = newAbortController();
    const token = ++detailReq;

    showView('detail');
    beginLoading();
    const hero = $('#detailHero');
    hero.innerHTML = `
      <div class="detail-hero-loading">
        <div class="inline-note loading" style="margin:auto;">
          <div class="inline-note-icon spin">${icon('loader', 18, 2.2)}</div>
          <div class="inline-note-body"><p class="inline-note-text">Memuat detail judul...</p></div>
        </div>
      </div>`;
    $('#episodePicker').style.display = 'none';
    try {
      const res = await Api.movie(id, type, signalOf(detailAbort));
      if (token !== detailReq) return;
      currentDetail = res.data;
      renderDetail(currentDetail);
    } catch (err) {
      if (isAbort(err) || token !== detailReq) return;
      console.error(err);
      renderDetailFallback(id, fallbackTitle, type);
    } finally {
      endLoading();
    }
  }

  function renderDetailFallback(id, title, type) {
    $('#detailHero').innerHTML = `
      <div class="detail-hero-content">
        <div class="detail-breadcrumb">
          <button class="detail-back-btn" onclick="window.__goHome()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Kembali
          </button>
        </div>
        <div class="detail-title">${escapeHtml(title)}</div>
      </div>`;
    $('#detailPoster').innerHTML = '';
    $('#detailOverview').innerHTML = `<div class="overview-label">Detail</div>
      <div class="inline-note error" style="margin-top:6px;">
        <div class="inline-note-icon">${icon('alert-triangle', 18, 2.2)}</div>
        <div class="inline-note-body"><p class="inline-note-text">Detail judul tidak dapat dimuat saat ini, tetapi kamu tetap bisa menonton.</p></div>
      </div>`;
    $('#predictionsBody').innerHTML = '';
  }

  function renderDetail(d) {
    const isAnichin = d.type === 'anichin' || String(d.id).startsWith('anichin:');
    const isTv = d.type === 'tv' || isAnichin || (d.episodes && d.episodes.length > 0);
    const playbackLabel = isAnichin ? 'Putar Episode 1' : (isTv ? 'Nonton S1 E1' : 'Putar Film');
    const badgeTypeHtml = isAnichin
      ? `<span class="meta-ico">${icon('sparkles', 13, 2.3)} Donghua Sub Indo</span>`
      : (isTv ? `<span class="meta-ico">${icon('tv', 13, 2.3)} Serial</span>` : '');

    $('#detailHero').innerHTML = `
      ${d.backdrop ? `<img class="detail-backdrop" src="${d.backdrop}" alt="" referrerpolicy="no-referrer"
         onerror="this.onerror=null;this.style.display='none'">` : ''}
      <div class="detail-hero-content">
        <div class="detail-breadcrumb">
          <button class="detail-back-btn" onclick="window.__goHome()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> Kembali
          </button>
        </div>
        ${d.genre ? `<div class="detail-genre">${d.genre.split(',').map(g => `<span class="genre-chip">${escapeHtml(g.trim())}</span>`).join('')}</div>` : ''}
        <div class="detail-title">${escapeHtml(d.title || d.name)}</div>
        <div class="detail-sub">
          ${d.release ? `<span>${escapeHtml(d.release)}</span>` : ''}
          ${d.duration ? `<span>•</span><span>${escapeHtml(d.duration)}</span>` : ''}
          ${d.rating ? `<span class="rating">${icon('star', 12, 2.3)} ${Number(d.rating).toFixed(1)}</span>` : ''}
          ${badgeTypeHtml ? `<span>•</span>${badgeTypeHtml}` : ''}
        </div>
        <div class="detail-actions">
          <button class="tactile-btn primary" id="playMainBtn">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${playbackLabel}
          </button>
        </div>
      </div>`;

    $('#detailPoster').innerHTML = d.poster
      ? `<img src="${posterUrl(d.poster)}" alt="${escapeHtml(d.title)}" referrerpolicy="no-referrer"
          onerror="this.closest('.detail-poster-box').innerHTML=''">`
      : '';

    const overview =
      `<div class="overview-label">Sinopsis</div>
       <p class="detail-description">${escapeHtml(d.overview || 'Belum ada sinopsis untuk judul ini.')}</p>
       <div class="detail-facts">
         ${fact('Rating', d.rating ? icon('star', 12, 2.3) + ' ' + Number(d.rating).toFixed(1) : '—')}
         ${fact('Tahun', d.release ? extractYear(d.release) : '—')}
         ${fact('Genre', d.genre || '—')}
         ${fact('Durasi', d.duration || '—')}
         ${d.network ? fact('Network', d.network) : ''}
         ${d.director ? fact('Sutradara', d.director) : ''}
         ${d.imdb_id ? fact('IMDb', linkImdb(d.imdb_id)) : ''}
       </div>`;
    $('#detailOverview').innerHTML = overview;

    const pred = buildPredictions(d);
    $('#predictionsBody').innerHTML = pred.map(p =>
      `<div class="fact-cell"><div class="fact-label">${p.label}</div><div class="fact-value">${p.value}</div></div>`
    ).join('');

    const playType = isAnichin ? 'anichin' : (isTv ? 'tv' : 'movie');
    // Prefetch sumber stream saat detail dibuka → putar jadi instan
    if (isTv) prefetchStream(d.id, playType, detailSelectedSeason || 1, 1);
    else prefetchStream(d.id, 'movie');

    $('#playMainBtn').addEventListener('click', () => {
      if (isTv) playStream(d.id, playType, detailSelectedSeason || 1, 1, d.title);
      else playStream(d.id, 'movie', null, null, d.title);
    });

    if (isTv) loadEpisodePicker(d.id, playType);
    else $('#episodePicker').style.display = 'none';
  }

  async function loadEpisodePicker(id, playType = 'tv') {
    const box = $('#episodePicker');
    box.style.display = '';
    $('#seasonTabs').innerHTML = '<span class="ep-hint">Memuat musim…</span>';
    $('#episodeList').innerHTML = '';
    const token = detailReq;
    try {
      const sres = await Api.tvSeasons(id, signalOf(detailAbort));
      if (token !== detailReq) return;
      detailSeasons = sres.data || [];
      if (!detailSeasons.length) {
        box.style.display = 'none';
        return;
      }
      detailSelectedSeason = detailSeasons[0].season || 1;
      renderSeasonTabs(id, playType);
      loadEpisodes(id, detailSelectedSeason, playType);
    } catch (e) {
      if (isAbort(e) || token !== detailReq) return;
      box.style.display = 'none';
    }
  }

  function renderSeasonTabs(id, playType = 'tv') {
    const tabs = $('#seasonTabs');
    tabs.innerHTML = '';
    detailSeasons.forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'season-tab' + (s.season === detailSelectedSeason ? ' active' : '');
      b.textContent = s.name ? `${s.name} (${s.episodes})` : ('S' + s.season + (s.episodes ? ` (${s.episodes})` : ''));
      b.dataset.s = s.season;
      b.addEventListener('click', () => {
        detailSelectedSeason = s.season;
        $$('#seasonTabs .season-tab').forEach(x => x.classList.toggle('active', Number(x.dataset.s) === s.season));
        loadEpisodes(id, s.season, playType);
        prefetchStream(id, playType, s.season, 1);
      });
      tabs.appendChild(b);
    });
  }

  async function loadEpisodes(id, season, playType = 'tv') {
    const token = ++episodeReq;
    const list = $('#episodeList');
    renderLoading(list, 'Memuat daftar episode...');
    try {
      const res = await Api.tvEpisodes(id, season, signalOf(detailAbort));
      if (token !== episodeReq) return;
      detailEpisodes = res.data || [];
      list.innerHTML = '';
      if (!detailEpisodes.length) {
        noteInto(list, 'empty', 'Belum ada episode untuk judul ini.');
        return;
      }
      detailEpisodes.forEach(ep => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'episode-item';
        const epNum = ep.episode || ep.episode_number || 1;
        el.innerHTML = `
          <span class="episode-num">E${epNum}</span>
          <span class="episode-info">
            <span class="episode-name">${escapeHtml(ep.name || 'Episode ' + epNum)}</span>
            ${ep.overview ? `<span class="episode-ov">${escapeHtml(ep.overview)}</span>` : ''}
          </span>`;
        el.addEventListener('click', () => {
          const isAni = playType === 'anichin' || String(id).startsWith('anichin:');
          const titleSuffix = isAni ? ` — Episode ${epNum}` : ` — S${season}E${epNum}`;
          playStream(id, playType, season, epNum, (currentDetail?.title || '') + titleSuffix);
        });
        list.appendChild(el);
      });
    } catch (e) {
      if (isAbort(e) || token !== episodeReq) return;
      noteInto(list, 'error', 'Gagal memuat daftar episode. Periksa koneksi lalu coba lagi.');
    }
  }

  function fact(label, value) {
    return `<div class="fact-cell"><div class="fact-label">${label}</div><div class="fact-value">${value}</div></div>`;
  }
  function extractYear(rel) { const m = String(rel).match(/\b(19|20)\d{2}\b/); return m ? m[0] : rel; }
  function linkImdb(id) { return `<a href="https://www.imdb.com/title/${id}" target="_blank" rel="noopener" style="color:var(--color-primary)">${id}</a>`; }

  function buildPredictions(d) {
    const r = Number(d.rating) || 0;
    const year = Number(extractYear(d.release)) || new Date().getFullYear();
    const potensi = r >= 7.5 ? 'Tinggi' : r >= 6 ? 'Sedang' : 'Rendah';
    const potensiIco = r >= 7.5 ? 'trending' : r >= 6 ? 'info' : 'alert';
    const populer = year >= new Date().getFullYear() - 1;
    return [
      { label: 'Skor Rotten', value: r ? `${icon('star', 12, 2.3)} ${Math.round(r * 10)}%` : '—' },
      { label: 'Potensi Nonton', value: `${potensiIco ? icon(potensiIco, 12, 2.3) : ''} ${potensi}` },
      { label: 'Prediksi Rating', value: r ? `${icon('star', 12, 2.3)} ${Math.min(10, r + 0.3).toFixed(1)}` : '—' },
      { label: 'Kategori Umur', value: d.adult ? 'Dewasa (18+)' : 'Semua Umur' },
      { label: 'Popularitas', value: `${populer ? icon('flame', 12, 2.3) : icon('calendar', 12, 2.3)} ${populer ? 'Baru rilis' : 'Tayang lama'}` }
    ];
  }

  // ── Full-Screen Search Tab Overlay Engine (Tap Full & Bagus) ──
  let fullSearchReq = 0;
  let fullSearchAbort = null;
  let fullSearchScope = 'all';
  let fullSearchLastResults = [];
  let fullSearchDebounceTimer = null;

  function openFullSearch(initialQuery = '') {
    const overlay = $('#fullSearchOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    setRoute({ view: 'search', query: initialQuery || '' });

    const input = $('#fullSearchInput');
    if (input) {
      input.value = initialQuery || '';
      setTimeout(() => input.focus(), 80);
    }

    const clearBtn = $('#fullSearchClearBtn');
    if (clearBtn) clearBtn.style.display = initialQuery ? '' : 'none';

    if (initialQuery && initialQuery.trim()) {
      executeFullSearch(initialQuery.trim());
    } else {
      showFullSearchDiscovery();
    }
  }

  function closeFullSearch() {
    const overlay = $('#fullSearchOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    if (fullSearchAbort) { try { fullSearchAbort.abort(); } catch (e) {} }

    if (watchState.id && currentView === 'watch') {
      setRoute({
        view: 'watch',
        id: watchState.id,
        type: watchState.type,
        season: watchState.season,
        episode: watchState.episode,
        title: watchState.title
      });
    } else {
      setRoute({ view: 'home', category: activeCategory });
    }
  }

  function showFullSearchDiscovery() {
    const disc = $('#fullSearchDiscovery');
    const resWrap = $('#fullSearchResultsContainer');
    if (disc) disc.style.display = 'flex';
    if (resWrap) resWrap.style.display = 'none';
  }

  function executeFullSearch(query) {
    const q = (query || '').trim();
    const clearBtn = $('#fullSearchClearBtn');
    if (clearBtn) clearBtn.style.display = q ? '' : 'none';

    if (!q) {
      setRoute({ view: 'search', query: '' }, true);
      showFullSearchDiscovery();
      return;
    }

    setRoute({ view: 'search', query: q }, true);

    const input = $('#fullSearchInput');
    if (input && input.value !== q) input.value = q;

    const disc = $('#fullSearchDiscovery');
    const resWrap = $('#fullSearchResultsContainer');
    if (disc) disc.style.display = 'none';
    if (resWrap) resWrap.style.display = 'block';

    const titleEl = $('#fullSearchResultsTitle');
    const countEl = $('#fullSearchResultsCount');
    const grid = $('#fullSearchResultsGrid');
    if (titleEl) titleEl.textContent = `Hasil untuk "${q}"`;
    if (countEl) countEl.textContent = 'Mencari...';
    if (grid) grid.innerHTML = renderSkeletonInto(8);

    if (fullSearchAbort) { try { fullSearchAbort.abort(); } catch (e) {} }
    fullSearchAbort = newAbortController();
    const token = ++fullSearchReq;

    beginLoading();
    Api.search(q, signalOf(fullSearchAbort)).then(res => {
      if (token !== fullSearchReq) return;
      fullSearchLastResults = res.data || [];
      renderFullSearchResults();
    }).catch(err => {
      if (isAbort(err) || token !== fullSearchReq) return;
      if (grid) noteInto(grid, 'error', 'Pencarian gagal. Periksa koneksi internet lalu coba lagi.');
      if (countEl) countEl.textContent = 'Gagal';
    }).finally(endLoading);
  }

  function renderFullSearchResults() {
    const grid = $('#fullSearchResultsGrid');
    const countEl = $('#fullSearchResultsCount');
    if (!grid) return;

    let items = fullSearchLastResults;
    if (fullSearchScope === 'donghua') {
      items = items.filter(x => x.provider === 'anichin' || x.type === 'anichin' || String(x.id).startsWith('anichin:'));
    } else if (fullSearchScope === 'movie') {
      items = items.filter(x => x.type === 'movie' && !String(x.id).startsWith('anichin:'));
    } else if (fullSearchScope === 'tv') {
      items = items.filter(x => x.type === 'tv' && !String(x.id).startsWith('anichin:'));
    } else if (fullSearchScope === 'horror') {
      items = items.filter(x => String(x.genre || '').toLowerCase().includes('horor') || String(x.genre || '').toLowerCase().includes('horror'));
    }

    grid.innerHTML = '';
    if (countEl) countEl.textContent = `${items.length} ditemukan`;

    if (!items.length) {
      noteInto(grid, 'empty', 'Tidak ada hasil yang sesuai dengan filter ini. Coba pilih kategori lain atau ubah kata kunci.');
      return;
    }

    items.forEach(m => {
      const card = renderMovieCard(m);
      card.addEventListener('click', () => {
        closeFullSearch();
      }, true);
      grid.appendChild(card);
    });
  }

  function setupFullSearchEvents() {
    const input = $('#fullSearchInput');
    const clearBtn = $('#fullSearchClearBtn');
    const backBtn = $('#fullSearchBackBtn');
    const submitBtn = $('#fullSearchSubmitBtn');

    if (input) {
      input.addEventListener('input', () => {
        const val = input.value;
        if (clearBtn) clearBtn.style.display = val ? '' : 'none';
        clearTimeout(fullSearchDebounceTimer);
        fullSearchDebounceTimer = setTimeout(() => {
          executeFullSearch(val);
        }, 280);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(fullSearchDebounceTimer);
          executeFullSearch(input.value);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (input) {
          input.value = '';
          input.focus();
        }
        clearBtn.style.display = 'none';
        showFullSearchDiscovery();
      });
    }

    if (backBtn) backBtn.addEventListener('click', closeFullSearch);
    if (submitBtn) submitBtn.addEventListener('click', () => {
      if (input) executeFullSearch(input.value);
    });

    // Trending quick tags
    $$('#fullSearchTrendingTags .full-search-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const q = tag.dataset.query;
        if (q) executeFullSearch(q);
      });
    });

    // Genre cards
    $$('.full-search-genre-card').forEach(card => {
      card.addEventListener('click', () => {
        const genre = card.dataset.genre;
        if (genre) executeFullSearch(genre);
      });
    });

    // Scope filter chips
    $$('#fullSearchFilters .full-search-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('#fullSearchFilters .full-search-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        fullSearchScope = chip.dataset.scope || 'all';
        renderFullSearchResults();
      });
    });
  }

  // ── Legacy In-Page Search ─────────────────────────────────
  function startSearch() {
    const q = $('#searchInput')?.value.trim();
    if (!q) {
      openFullSearch();
      return;
    }
    openFullSearch(q);
  }

  function renderSkeletonInto(n) {
    let h = '';
    for (let i = 0; i < n; i++) h += `<div class="skeleton-card"><div class="skeleton-shimmer-box skeleton-poster"></div></div>`;
    return h;
  }

  // ── Playback (Full Page Watch View) ──────────────────────
  async function playStream(id, type, season, episode, title) {
    // Mulai sesi baru; request sesi lama langsung dibatalkan agar beban hilang
    // dan respons terlambat tidak menimpa judul yang baru dipilih.
    const session = beginWatchSession();
    const token = session.token;
    const signal = session.signal;

    // Simpan progres episode yang sedang berjalan sebelum pindah judul/episode
    setWatchProgress();

    showView('watch');
    resetPlayerUI(title);

    watchState.id = id;
    watchState.type = type || 'movie';
    watchState.season = season || null;
    watchState.episode = episode || null;
    watchState.title = title || '';
    watchState.detail = null;
    watchState.stream = null;
    watchState.qualities = {};
    watchState.qualityKey = null;
    watchState.myVote = 0;
    watchState.myRating = 0;

    setRoute({
      view: 'watch',
      id,
      type: type || 'movie',
      season: season || null,
      episode: episode || null,
      title: title || ''
    });

    Api.movie(id, type, signal).then(res => {
      if (!isWatchActive(token)) return;
      watchState.detail = res.data || null;
      renderWatchInfo();
    }).catch(() => {});

    const isAnichin = watchState.type === 'anichin' || String(id).startsWith('anichin:');
    const isSeries = watchState.type === 'tv' || isAnichin;

    if (isSeries && (season || isAnichin)) {
      renderEpisodeStrip(id, season || 1, episode || 1, token, signal);
    } else {
      $('#watchEpisodes').style.display = 'none';
      episodeStripData = { id: null, season: null, episodes: [] };
    }

    loadWatchRelated(id, watchState.type, token, signal);

    try {
      const res = await Api.play(id, type, season, episode, signal);
      if (!isWatchActive(token)) return;
      const stream = res.playlist || {};
      watchState.stream = stream;

      const hasDirect = !!(stream.mp4 || stream.playlist);
      const hasEmbed = !!(stream.embed || (stream.mirrors && stream.mirrors.length));

      if (!hasDirect && !hasEmbed) throw new Error('Tidak ada stream');

      setupWatchServers(stream, token);

      if (hasDirect) {
        setupQualities(stream);
        initPlayer(stream, false, token);
      } else {
        const embedUrl = stream.embed || stream.mirrors[0].url;
        playIframe(embedUrl, token);
      }
    } catch (err) {
      if (isAbort(err) || !isWatchActive(token)) return;
      console.error(err);
      $('#playerStatus').style.display = 'none';
      const errBox = $('#playerError');
      errBox.style.display = '';
      const notFound = err && (err.status === 404 || /not found/i.test(err.code || ''));
      if (notFound) {
        errBox.innerHTML = playerErrorHtml(
          'Judul belum tersedia untuk diputar.',
          'Sumber video untuk judul ini belum tersedia. Coba pilih judul lain, atau coba lagi nanti — katalog sumber terus diperbarui.'
        );
      } else {
        errBox.innerHTML = playerErrorHtml(
          'Sumber video tidak dapat dimuat.',
          'Server sumber sedang tidak merespons. Periksa koneksi internet lalu coba lagi beberapa saat.'
        );
      }
    }
  }

  function setupWatchServers(stream, token) {
    const box = $('#watchServers');
    const list = $('#watchServersList');
    if (!box || !list) return;

    const mirrors = stream.mirrors || [];
    const hasDirect = !!(stream.mp4 || stream.playlist);

    if (!mirrors.length) {
      box.style.display = 'none';
      list.innerHTML = '';
      return;
    }

    list.innerHTML = '';
    box.style.display = '';

    if (hasDirect) {
      const btnDirect = document.createElement('button');
      btnDirect.type = 'button';
      btnDirect.className = 'watch-server-btn active';
      btnDirect.innerHTML = `${icon('play', 12, 2.3)} Server Utama (Direct HD)`;
      btnDirect.addEventListener('click', () => {
        if (!isWatchActive(token)) return;
        $$('#watchServersList .watch-server-btn').forEach(b => b.classList.remove('active'));
        btnDirect.classList.add('active');
        switchToDirect(stream, token);
      });
      list.appendChild(btnDirect);
    }

    mirrors.forEach((m, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'watch-server-btn' + (!hasDirect && idx === 0 ? ' active' : '');
      btn.innerHTML = `${icon('broadcast', 12, 2.3)} ${escapeHtml(m.name || 'Server ' + (idx + 1))}`;
      btn.addEventListener('click', () => {
        if (!isWatchActive(token)) return;
        $$('#watchServersList .watch-server-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playIframe(m.url, token);
      });
      list.appendChild(btn);
    });
  }

  function switchToDirect(stream, token) {
    const video = $('#playerVideo');
    const iframe = $('#playerIframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
    if (video) video.style.display = '';
    $('#playerError').style.display = 'none';
    $('#playerStatus').style.display = '';
    $('#playerStatus').textContent = 'Memutar via server utama...';
    setupQualities(stream);
    initPlayer(stream, false, token);
  }

  function playIframe(embedUrl, token) {
    if (!isWatchActive(token)) return;
    destroyHls();
    const video = $('#playerVideo');
    const iframe = $('#playerIframe');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.style.display = 'none';
    }
    $('#playerStatus').style.display = 'none';
    $('#playerError').style.display = 'none';
    $('#qualityPicker').style.display = 'none';
    closeQualityMenu();

    if (iframe) {
      iframe.style.display = '';
      iframe.src = embedUrl;
    }
  }

  function playerErrorHtml(title, desc) {
    return `<div class="player-error-inner">
      <div class="player-error-ico">${icon('alert-triangle', 26, 2)}</div>
      <h3 class="player-error-title">${escapeHtml(title)}</h3>
      <p class="player-error-desc">${escapeHtml(desc)}</p>
      <div class="player-error-actions">
        <button type="button" class="tactile-btn primary" onclick="window.__retryLast()">${icon('loader', 16, 2.3)} Coba Lagi</button>
        <button type="button" class="tactile-btn" onclick="window.__goHome()">${icon('chevron-down', 16, 2.3)} Ke Beranda</button>
      </div>
    </div>`;
  }

  function resetPlayerUI(title) {
    if (window.__clearIndicatorUI) window.__clearIndicatorUI();
    const iframe = $('#playerIframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
    const video = $('#playerVideo');
    video.style.display = '';
    const status = $('#playerStatus');
    const errBox = $('#playerError');
    errBox.style.display = 'none';
    errBox.innerHTML = '';
    status.style.display = '';
    status.innerHTML = `<span class="player-spin">${icon('loader', 18, 2.3)}</span> Memuat video...`;
    destroyHls();
    video.pause();
    video.removeAttribute('src');
    video.load();
    const servers = $('#watchServers');
    if (servers) servers.style.display = 'none';
    const serverList = $('#watchServersList');
    if (serverList) serverList.innerHTML = '';
    $('#watchTitle').textContent = title || 'Memuat...';
    $('#watchSub').innerHTML = '';
    $('#watchDesc').textContent = '';
    $('#watchMeta').innerHTML = '';
    $('#watchAvatarImg').src = '/img/no-poster.svg';
    closeQualityMenu();
    const qPicker = $('#qualityPicker');
    if (qPicker) qPicker.style.display = 'none';
    $('#watchEpisodes').style.display = 'none';
    $('#watchEpsScroll').innerHTML = '';
    const epBadge = $('#watchEpCurrentBadge');
    if (epBadge) epBadge.textContent = 'Ep 1';
    const epTotal = $('#watchEpTotalCount');
    if (epTotal) epTotal.textContent = '0 Episode';
    episodeStripData = { id: null, season: null, episodes: [] };
    const relBox = $('#watchRelated');
    if (relBox) relBox.style.display = 'none';
    const relStrip = $('#watchRelatedStrip');
    if (relStrip) relStrip.innerHTML = '';
  }

  function setupQualities(stream) {
    const q = stream.qualities || {};
    const keys = Object.keys(q)
      .filter(k => q[k])
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    watchState.qualities = q;

    const qPicker = $('#qualityPicker');
    if (!qPicker) {
      if (keys.length) {
        watchState.qualityKey = stream.playlist ? 'auto' : keys[0];
      }
      return;
    }

    const menu = $('#qualityMenu');
    if (menu) menu.innerHTML = '';
    const qLabel = $('#qualityLabel');
    if (qLabel) qLabel.textContent = 'Auto';

    if (!keys.length && !stream.playlist) {
      watchState.qualityKey = null;
      if (menu) menu.innerHTML = `<div class="quality-empty">Pilihan belum tersedia untuk judul ini.</div>`;
      qPicker.style.display = 'none';
      return;
    }

    if (stream.playlist && menu) {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'quality-item quality-play' + (keys.length ? '' : ' active');
      auto.dataset.key = 'auto';
      auto.innerHTML = `<span class="quality-item-res">Auto</span><span class="quality-item-sub">HLS adaptif</span>`;
      auto.addEventListener('click', () => selectQuality('auto'));
      menu.appendChild(auto);
      if (!keys.length) watchState.qualityKey = 'auto';
    }

    if (menu) {
      keys.forEach((k, i) => {
        const isDefault = !stream.playlist && i === 0;
        const row = document.createElement('div');
        row.className = 'quality-row';

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'quality-item quality-play' + (isDefault ? ' active' : '');
        play.dataset.key = k;
        play.innerHTML = `<span class="quality-item-res">${escapeHtml(k)}p</span><span class="quality-item-sub">Putar</span>`;
        play.addEventListener('click', () => selectQuality(k));
        row.appendChild(play);

        menu.appendChild(row);
      });
    }

    if (keys.length) {
      watchState.qualityKey = stream.playlist ? 'auto' : keys[0];
    }
    if (qLabel) qLabel.textContent = watchState.qualityKey === 'auto' ? 'Auto' : watchState.qualityKey + 'p';
    qPicker.style.display = 'none';
  }

  function proxySrc(u) { return '/proxy/hls?url=' + encodeURIComponent(u); }

  // Putar media langsung dari CDN (cepat, tanpa relay serverless). Bila gagal
  // (mis. CDN tertentu butuh Referer), otomatis fallback ke proxy.
  function playMedia(video, url, token, onFatal) {
    const stale = () => token !== undefined && !isWatchActive(token);
    let triedProxy = false;
    const hide = () => {
      if (stale()) return;
      $('#playerStatus').style.display = 'none';
      video.removeEventListener('error', onError);
    };
    const onError = () => {
      if (stale()) return;
      if (!triedProxy) {
        triedProxy = true;
        video.src = proxySrc(url);
        video.load();
        video.play().catch(() => {});
        return;
      }
      video.removeEventListener('error', onError);
      if (typeof onFatal === 'function') onFatal();
    };
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', () => {
      attemptResumePlayback(video);
      hide();
    }, { once: true });
    video.addEventListener('playing', hide, { once: true });
    video.src = url;
    video.play().catch(() => {});
  }

  function selectQuality(k) {
    watchState.qualityKey = k;
    $$('#qualityMenu .quality-item').forEach(b => b.classList.toggle('active', b.dataset.key === k));
    $('#qualityLabel').textContent = k === 'auto' ? 'Auto' : k + 'p';
    closeQualityMenu();

    const stream = watchState.stream || {};
    const video = $('#playerVideo');
    if (k !== 'auto' && watchState.qualities[k]) {
      destroyHls();
      const pos = video.currentTime;
      const wasPlaying = !video.paused;
      video.addEventListener('loadedmetadata', () => {
        try { video.currentTime = pos || 0; } catch (e) {}
        if (wasPlaying) video.play().catch(() => {});
      }, { once: true });
      playMedia(video, watchState.qualities[k], watchSession, () => {
        $('#playerStatus').style.display = 'none';
        $('#playerError').style.display = '';
        $('#playerError').innerHTML = playerErrorHtml(
          'Resolusi ini gagal diputar.',
          'Coba pilih resolusi lain dari menu Resolusi & Unduhan di atas.'
        );
      });
      return;
    }
    if (k === 'auto' && stream.playlist) {
      initPlayer(stream, true, watchSession);
    }
  }

  function initPlayer(stream, forceHls, token) {
    const stale = () => token !== undefined && !isWatchActive(token);
    destroyHls();
    const video = $('#playerVideo');
    const mp4 = stream.mp4;

    if (mp4 && !forceHls) {
      // Putar langsung dari CDN agar buffering instan (fallback ke proxy otomatis).
      playMedia(video, mp4, token, () => {
        $('#playerStatus').style.display = 'none';
        $('#playerError').style.display = '';
        $('#playerError').innerHTML = playerErrorHtml(
          'Video gagal diputar.',
          'Tekan tombol putar pada video, atau pilih resolusi lain dari menu Resolusi & Unduhan.'
        );
      });
      return;
    }

    const playlistUrl = stream.playlist;
    if (!playlistUrl) {
      $('#playerStatus').style.display = 'none';
      if (!$('#playerVideo').currentSrc) {
        $('#playerError').style.display = '';
        $('#playerError').innerHTML = playerErrorHtml(
          'Tidak ada sumber video.',
          'Judul ini belum memiliki tautan video yang dapat diputar saat ini.'
        );
      }
      return;
    }

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, enableWorker: true, manifestLoadingTimeOut: 20000 });
      hls.loadSource('/proxy/hls?url=' + encodeURIComponent(playlistUrl));
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (stale()) return;
        $('#playerStatus').style.display = 'none';
        attemptResumePlayback(video);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (stale()) return;
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); }
          else {
            $('#playerStatus').style.display = 'none';
            $('#playerError').style.display = '';
            $('#playerError').innerHTML = playerErrorHtml(
              'Stream terputus.',
              'Koneksi ke server video terputus saat pemutaran. Periksa jaringan lalu coba lagi.'
            );
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = '/proxy/hls?url=' + encodeURIComponent(playlistUrl);
      video.addEventListener('loadeddata', () => {
        if (!stale()) {
          $('#playerStatus').style.display = 'none';
          attemptResumePlayback(video);
        }
      }, { once: true });
      video.play().catch(() => {});
    } else {
      $('#playerError').style.display = '';
      $('#playerError').innerHTML = playerErrorHtml(
        'Format tidak didukung.',
        'Browser ini tidak mendukung pemutar video HLS. Gunakan browser terbaru seperti Chrome atau Safari.'
      );
    }
  }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  }

// ── Episode Strip + progres tontonan (disimpan di localStorage) ──
  const PROGRESS_KEY = 'yn_progress_v1';
  let episodeStripData = { id: null, season: null, episodes: [] };
  const episodeCache = new Map();

  function loadProgressStore() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveProgressStore(store) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(store)); } catch (e) {}
  }
  function progressKey(id, season, episode) { return id + ':' + season + ':' + episode; }
  function getProgressRatio(id, season, episode) {
    const rec = loadProgressStore()[progressKey(id, season, episode)];
    return rec && typeof rec.r === 'number' ? rec.r : 0;
  }
  function setWatchProgress() {
    if (!watchState.id) return;
    const video = $('#playerVideo');
    if (!video) return;
    const dur = video.duration;
    if (!dur || !isFinite(dur) || dur <= 0) return;
    const ratio = Math.max(0, Math.min(1, video.currentTime / dur));
    const store = loadProgressStore();
    const isAni = watchState.type === 'anichin' || String(watchState.id).startsWith('anichin:');
    const isSeries = watchState.type === 'tv' || isAni;
    const s = isSeries ? (watchState.season || 1) : 'movie';
    const ep = isSeries ? (watchState.episode || 1) : 1;
    store[progressKey(watchState.id, s, ep)] = {
      r: ratio, t: video.currentTime, d: dur, at: Date.now()
    };
    saveProgressStore(store);
  }

  function attemptResumePlayback(video) {
    if (!video || !watchState.id) return;
    const isAni = watchState.type === 'anichin' || String(watchState.id).startsWith('anichin:');
    const isSeries = watchState.type === 'tv' || isAni;
    const s = isSeries ? (watchState.season || 1) : 'movie';
    const ep = isSeries ? (watchState.episode || 1) : 1;
    const key = progressKey(watchState.id, s, ep);
    const rec = loadProgressStore()[key];
    if (rec && typeof rec.t === 'number' && rec.t > 3 && rec.r < 0.95) {
      const targetTime = rec.t;
      const doSeek = () => {
        try {
          if (Math.abs(video.currentTime - targetTime) > 2) {
            video.currentTime = targetTime;
          }
        } catch (e) {}
      };
      if (video.readyState >= 1) {
        doSeek();
      } else {
        video.addEventListener('loadedmetadata', doSeek, { once: true });
      }
    }
  }

  function updateEpisodeBars() {
    $$('#watchEpsScroll .watch-ep-chip').forEach(chip => {
      const ep = Number(chip.dataset.ep);
      const ratio = getProgressRatio(episodeStripData.id, episodeStripData.season, ep);
      const bar = chip.querySelector('.watch-ep-chip-bar');
      if (bar) bar.style.width = Math.round(ratio * 100) + '%';
      chip.classList.toggle('done', ratio >= 0.98);
    });
  }

  function scrollActiveEpisodeIntoView() {
    const active = $('#watchEpsScroll .watch-ep-chip.active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function stripTitleFor(ep) {
    const base = (watchState.detail && (watchState.detail.title || watchState.detail.name)) || watchState.title || '';
    const clean = String(base).replace(/\s*—\s*(S\d+E\d+|Episode\s*\d+)\s*$/, '').trim();
    const isAni = watchState.type === 'anichin' || String(watchState.id).startsWith('anichin:');
    return isAni ? `${clean || 'Donghua'} — Episode ${ep}` : `${clean || 'Episode'} — S${watchState.season || 1}E${ep}`;
  }

  async function renderEpisodeStrip(id, season, episode, token, signal) {
    const wrap = $('#watchEpisodes');
    const scroll = $('#watchEpsScroll');
    wrap.style.display = '';

    const curBadge = $('#watchEpCurrentBadge');
    if (curBadge) curBadge.textContent = 'Ep ' + (episode || 1);
    const totalCount = $('#watchEpTotalCount');
    if (totalCount) totalCount.textContent = 'Memuat...';

    const cacheKey = id + ':' + (season || 1);
    let eps = episodeCache.get(cacheKey);
    if (!eps) {
      scroll.innerHTML = '<span class="ep-hint">Memuat episode...</span>';
      try {
        const res = await Api.tvEpisodes(id, season || 1, signal);
        if (!isWatchActive(token)) return;
        eps = res.data || [];
        episodeCache.set(cacheKey, eps);
      } catch (e) {
        if (isAbort(e) || !isWatchActive(token)) return;
        wrap.style.display = 'none';
        return;
      }
    }
    if (!isWatchActive(token)) return;

    episodeStripData = { id, season: season || 1, episodes: eps };
    if (!eps.length) { wrap.style.display = 'none'; return; }
    if (totalCount) totalCount.textContent = eps.length + ' Episode';
    scroll.innerHTML = '';
    eps.forEach(ep => {
      const epNum = ep.episode || ep.episode_number || 1;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'watch-ep-chip' + (Number(epNum) === Number(episode) ? ' active' : '');
      chip.dataset.ep = epNum;
      chip.title = 'Episode ' + epNum;
      chip.innerHTML = `<span class="watch-ep-chip-prefix">EP</span><span class="watch-ep-chip-num">${epNum}</span><span class="watch-ep-chip-bar"></span>`;
      chip.addEventListener('click', () => {
        if (Number(epNum) === Number(watchState.episode)) return;
        playStream(id, watchState.type, season || 1, epNum, stripTitleFor(epNum));
      });
      scroll.appendChild(chip);
    });
    updateEpisodeBars();
    scrollActiveEpisodeIntoView();
  }

  // ── Watch Info ───────────────────────────────────────────
  function renderWatchInfo() {
    const d = watchState.detail || {};
    const title = d.title || d.name || watchState.title;
    $('#watchTitle').textContent = title || 'Tanpa Judul';

    const avatar = $('#watchAvatarImg');
    if (d.poster) {
      avatar.src = posterUrl(d.poster);
      avatar.onerror = () => { avatar.onerror = null; avatar.src = '/img/no-poster.svg'; };
    } else {
      avatar.src = '/img/no-poster.svg';
    }

    const isAnichin = watchState.type === 'anichin' || String(watchState.id).startsWith('anichin:');
    const parts = [];
    if (d.duration) parts.push(escapeHtml(d.duration));
    if (d.release) parts.push(escapeHtml(d.release));
    if (d.rating) parts.push(`<span class="rating">${icon('star', 12, 2.3)} ${Number(d.rating).toFixed(1)}</span>`);
    if (isAnichin) {
      parts.push(`<span class="meta-ico">${icon('sparkles', 13, 2.3)} Donghua Sub Indo</span>`);
    } else if (watchState.type === 'tv') {
      parts.push(`<span class="meta-ico">${icon('tv', 13, 2.3)} Serial</span>`);
    }
    $('#watchSub').innerHTML = parts.join('<span class="dot-sep">•</span>');

    $('#watchDesc').textContent = d.overview || 'Belum ada deskripsi untuk judul ini.';

    const chips = [];
    if (d.genre) chips.push({ label: 'Genre', value: d.genre });
    if (d.network) chips.push({ label: 'Network', value: d.network });
    if (d.studio) chips.push({ label: 'Studio', value: d.studio });
    if (d.certification) chips.push({ label: 'Rating Usia', value: d.certification });
    if (isAnichin) {
      chips.push({ label: 'Episode', value: `Episode ${watchState.episode || 1}` });
    } else if (watchState.type === 'tv') {
      chips.push({ label: 'Episode', value: `S${watchState.season || 1} E${watchState.episode || 1}` });
    }
    $('#watchMeta').innerHTML = chips.map(c =>
      `<div class="fact-cell"><div class="fact-label">${escapeHtml(c.label)}</div><div class="fact-value">${escapeHtml(c.value)}</div></div>`
    ).join('');
  }



  // ── Rekomendasi Pilihan Hari Ini (Slider Film/Tayangan Berganti Tiap Hari) ──
  async function loadWatchRelated(currentId, currentType, token, signal) {
    const wrap = $('#watchRelated');
    const strip = $('#watchRelatedStrip');
    if (!wrap || !strip) return;

    wrap.style.display = '';
    strip.innerHTML = `
      <div class="watch-related-loading">
        <span class="player-spin">${icon('loader', 16, 2.3)}</span> Menyiapkan tayangan pilihan hari ini...
      </div>`;

    try {
      const isAni = currentType === 'anichin' || String(currentId).startsWith('anichin:');
      let candidates = [];

      if (isAni) {
        const [pop, ongoing] = await Promise.allSettled([
          Api.catalog('donghua-populer', 1),
          Api.catalog('donghua-ongoing', 1)
        ]);
        const listA = (pop.status === 'fulfilled' && pop.value && pop.value.data) || [];
        const listB = (ongoing.status === 'fulfilled' && ongoing.value && ongoing.value.data) || [];
        candidates = [...listA, ...listB];
      } else {
        const [trend, top, indo] = await Promise.allSettled([
          Api.catalog('trending', 1),
          Api.catalog('top-100', 1),
          Api.catalog('film-indonesia', 1)
        ]);
        const listA = (trend.status === 'fulfilled' && trend.value && trend.value.data) || [];
        const listB = (top.status === 'fulfilled' && top.value && top.value.data) || [];
        const listC = (indo.status === 'fulfilled' && indo.value && indo.value.data) || [];
        candidates = [...listA, ...listB, ...listC];
      }

      if (!isWatchActive(token)) return;

      const seen = new Set();
      const valid = [];
      const currStr = String(currentId).toLowerCase();
      candidates.forEach(it => {
        if (!it || !it.id) return;
        const idStr = String(it.id).toLowerCase();
        if (idStr === currStr) return;
        if (seen.has(idStr)) return;
        seen.add(idStr);
        valid.push(it);
      });

      if (!valid.length) {
        wrap.style.display = 'none';
        return;
      }

      // Algoritma rotasi harian deterministik berdasarkan tanggal hari ini
      const now = new Date();
      const daySeed = (now.getFullYear() * 372) + ((now.getMonth() + 1) * 31) + now.getDate();
      const offset = daySeed % valid.length;
      const dailyRotated = [...valid.slice(offset), ...valid.slice(0, offset)].slice(0, 16);

      strip.innerHTML = '';
      dailyRotated.forEach(item => {
        const card = renderRelatedCard(item);
        if (card) strip.appendChild(card);
      });
    } catch (e) {
      if (isAbort(e) || !isWatchActive(token)) return;
      wrap.style.display = 'none';
    }
  }

  function renderRelatedCard(item) {
    if (!item || !item.id) return null;
    const card = document.createElement('div');
    card.className = 'related-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const poster = item.poster ? posterUrl(item.poster) : '/img/no-poster.svg';
    const title = item.title || item.name || 'Tanpa Judul';
    const rating = Number(item.rating || item.vote_average || 0);
    const year = extractYear(item.release_date || item.release || item.first_air_date || '');
    const isAni = item.type === 'anichin' || String(item.id).startsWith('anichin:');
    const badgeLabel = isAni ? 'Donghua' : (item.type === 'tv' ? 'Serial' : 'Film');

    card.innerHTML = `
      <div class="related-card-poster-wrap">
        <img class="related-card-img" src="${poster}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.onerror=null;this.src='/img/no-poster.svg';">
        <span class="related-card-badge">${escapeHtml(badgeLabel)}</span>
        <div class="related-card-play-overlay">
          <span class="related-card-play-btn">
            ${icon('play', 16, 2.5)}
          </span>
        </div>
      </div>
      <div class="related-card-info">
        <div class="related-card-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="related-card-meta">
          ${rating > 0 ? `<span class="related-card-rating">${icon('star', 11, 2.3)} ${rating.toFixed(1)}</span>` : ''}
          ${year ? `<span class="related-card-year">${escapeHtml(year)}</span>` : ''}
        </div>
      </div>
    `;

    const handleAction = () => {
      const targetType = isAni ? 'anichin' : (item.type || 'movie');
      playStream(item.id, targetType, 1, 1, title);
      const stage = $('#watchStage');
      if (stage && stage.scrollIntoView) {
        stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    card.addEventListener('click', handleAction);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleAction();
      }
    });

    return card;
  }

  function closePlayer() {
    setWatchProgress();
    closeQualityMenu();
    destroyHls();
    const iframe = $('#playerIframe');
    if (iframe) {
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
    }
    const v = $('#playerVideo');
    if (v) {
      v.style.display = '';
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    const servers = $('#watchServers');
    if (servers) servers.style.display = 'none';
    const serverList = $('#watchServersList');
    if (serverList) serverList.innerHTML = '';
    const relBox = $('#watchRelated');
    if (relBox) relBox.style.display = 'none';
    const relStrip = $('#watchRelatedStrip');
    if (relStrip) relStrip.innerHTML = '';
    watchState.id = null;
    watchState.myVote = 0;
    watchState.myRating = 0;
    setRoute({ view: 'home', category: activeCategory });
    showView(returnView || 'home');
  }

  function toggleQualityMenu() {
    const menu = $('#qualityMenu');
    if (!menu) return;
    const open = menu.classList.toggle('open');
    const picker = $('#qualityPicker');
    if (picker) picker.classList.toggle('menu-open', open);
  }
  function closeQualityMenu() {
    const menu = $('#qualityMenu');
    if (menu) menu.classList.remove('open');
    const picker = $('#qualityPicker');
    if (picker) picker.classList.remove('menu-open');
  }

  // ── Events ───────────────────────────────────────────────
  function wireEvents() {
    setupFullSearchEvents();

    $('#headerLogo').addEventListener('click', () => {
      const fullSearch = $('#fullSearchOverlay');
      if (fullSearch && fullSearch.style.display !== 'none') closeFullSearch();
      if (currentView === 'watch') closePlayer();
      setRoute({ view: 'home', category: 'trending' });
      activeCategory = 'trending';
      loadCatalog('trending');
      $$('#filterTabs .neu-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === 'trending'));
      showView('home');
    });

    const homeInput = $('#searchInput');
    if (homeInput) {
      homeInput.addEventListener('click', () => openFullSearch(homeInput.value));
      homeInput.addEventListener('focus', () => openFullSearch(homeInput.value));
      homeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startSearch();
      });
    }

    $('#searchBtn')?.addEventListener('click', startSearch);
    $('#headerSearchBtn')?.addEventListener('click', () => {
      openFullSearch(homeInput?.value || '');
    });

    $('#headerRefreshBtn').addEventListener('click', () => {
      loadHome();
    });

    $('#loadMoreBtn').addEventListener('click', loadMore);

    $('#playerBackBtn').addEventListener('click', () => { closePlayer(); });

    $('#watchEpNavPrev')?.addEventListener('click', () => {
      const sc = $('#watchEpsScroll');
      if (sc) sc.scrollBy({ left: -260, behavior: 'smooth' });
    });
    $('#watchEpNavNext')?.addEventListener('click', () => {
      const sc = $('#watchEpsScroll');
      if (sc) sc.scrollBy({ left: 260, behavior: 'smooth' });
    });
    $('#watchRelatedPrev')?.addEventListener('click', () => {
      const st = $('#watchRelatedStrip');
      if (st) st.scrollBy({ left: -320, behavior: 'smooth' });
    });
    $('#watchRelatedNext')?.addEventListener('click', () => {
      const st = $('#watchRelatedStrip');
      if (st) st.scrollBy({ left: 320, behavior: 'smooth' });
    });

    // Progres tontonan untuk strip episode (throttle 3s + saat jeda/selesai)
    let lastProgressSave = 0;
    const playerVideo = $('#playerVideo');
    playerVideo.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastProgressSave < 3000) return;
      lastProgressSave = now;
      setWatchProgress();
      updateEpisodeBars();
    });
    playerVideo.addEventListener('pause', () => { setWatchProgress(); updateEpisodeBars(); });
    playerVideo.addEventListener('ended', () => { setWatchProgress(); updateEpisodeBars(); });

    // ── Auto-hide kontrol: tombol kembali & overlay muncul saat jeda/disentuh ──
    const playerWrap = $('#watchVideoWrap');
    const stateIndicator = $('#playerStateIndicator');
    let hideControlsTimer = null;

    function revealControls(temporary) {
      if (!playerWrap) return;
      playerWrap.classList.remove('controls-hidden');
      clearTimeout(hideControlsTimer);
      if (temporary && !playerVideo.paused && !playerVideo.ended) {
        hideControlsTimer = setTimeout(() => {
          if (!playerVideo.paused && !playerVideo.ended) playerWrap.classList.add('controls-hidden');
        }, 3000);
      }
    }

    function setPausedUI() {
      if (!playerWrap || !stateIndicator) return;
      clearTimeout(hideControlsTimer);
      stateIndicator.classList.remove('is-anim-play');
      stateIndicator.classList.add('is-paused');
      playerWrap.classList.remove('controls-hidden');
    }

    function setPlayingUI(pulse) {
      if (!playerWrap || !stateIndicator) return;
      stateIndicator.classList.remove('is-paused');
      playerWrap.classList.add('controls-hidden');
      clearTimeout(hideControlsTimer);
      if (pulse) {
        void stateIndicator.offsetWidth;
        stateIndicator.classList.add('is-anim-play');
        setTimeout(() => stateIndicator.classList.remove('is-anim-play'), 700);
      }
    }

    function clearIndicatorUI() {
      if (!playerWrap || !stateIndicator) return;
      clearTimeout(hideControlsTimer);
      stateIndicator.classList.remove('is-paused', 'is-anim-play');
      playerWrap.classList.remove('controls-hidden');
    }

    playerVideo.addEventListener('play', () => setPlayingUI(true));
    playerVideo.addEventListener('pause', setPausedUI);
    playerVideo.addEventListener('ended', setPausedUI);
    stateIndicator.addEventListener('click', (e) => {
      e.stopPropagation();
      if (playerVideo.paused || playerVideo.ended) playerVideo.play();
    });
    ['touchstart', 'mousemove'].forEach((ev) => {
      playerVideo.addEventListener(ev, () => {
        if (!playerVideo.paused && !playerVideo.ended) revealControls(true);
      }, { passive: true });
    });
    window.__clearIndicatorUI = clearIndicatorUI;

    // Fullscreen pemutar → paksa orientasi landscape agar tidak terkunci portrait
    const applyOrientation = (landscape) => {
      const so = screen.orientation;
      if (!so || typeof so.lock !== 'function') return;
      if (landscape) so.lock('landscape').catch(() => {});
      else if (typeof so.unlock === 'function') so.unlock();
    };
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      applyOrientation(!!fsEl && (fsEl === playerVideo || playerVideo.contains(fsEl) || fsEl.contains(playerVideo)));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    playerVideo.addEventListener('webkitbeginfullscreen', () => applyOrientation(true));
    playerVideo.addEventListener('webkitendfullscreen', () => applyOrientation(false));

    $('#qualityToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQualityMenu();
    });
    document.addEventListener('click', (e) => {
      const picker = $('#qualityPicker');
      if (picker && !e.target.closest('#qualityPicker')) closeQualityMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const fullSearch = $('#fullSearchOverlay');
        if (fullSearch && fullSearch.style.display !== 'none') {
          closeFullSearch();
          return;
        }
        const menu = $('#qualityMenu');
        if (menu && menu.classList.contains('open')) { closeQualityMenu(); return; }
        if (currentView === 'watch') closePlayer();
      } else if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        openFullSearch();
      }
    });

    window.addEventListener('hashchange', () => {
      if (isApplyingRoute) return;
      const r = parseHash(window.location.hash) || { view: 'home', category: activeCategory };
      applyRoute(r);
    });

    window.addEventListener('beforeunload', () => {
      setWatchProgress();
    });

    window.addEventListener('scroll', () => {
      if (currentView === 'home') {
        try { sessionStorage.setItem('yn_home_scrollY', String(Math.round(window.scrollY))); } catch (e) {}
      }
    }, { passive: true });

    window.__goHome = () => {
      closePlayer();
      showView('home');
    };
    window.__retryLast = () => {
      playStream(watchState.id, watchState.type, watchState.season, watchState.episode, watchState.title);
    };
  }

  // ── Boot ────────────────────────────────────────────────
  async function boot() {
    wireEvents();

    const initialRoute = getCurrentRoute();
    if (initialRoute.category) {
      activeCategory = initialRoute.category;
    }

    // Preload home catalog & rows in background so home is ready when exiting watch/search
    loadHome().then(() => {
      if (initialRoute.view === 'home') {
        try {
          const sy = Number(sessionStorage.getItem('yn_home_scrollY'));
          if (sy > 0) window.scrollTo({ top: sy, behavior: 'auto' });
        } catch (e) {}
      }
    });

    if (initialRoute.view === 'watch' && initialRoute.id) {
      playStream(
        initialRoute.id,
        initialRoute.type,
        initialRoute.season,
        initialRoute.episode,
        initialRoute.title
      );
    } else if (initialRoute.view === 'search') {
      showView('home');
      openFullSearch(initialRoute.query || '');
    } else if (initialRoute.view === 'detail' && initialRoute.id) {
      openDetail(initialRoute.id, initialRoute.title, initialRoute.type);
    } else {
      showView('home');
    }
  }

  boot();
})();