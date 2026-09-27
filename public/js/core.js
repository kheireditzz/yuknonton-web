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

  // ── View Switching ───────────────────────────────────────
  function showView(name) {
    // Keluar dari watch view → batalkan request stream yang masih berjalan
    if (currentView === 'watch' && name !== 'watch') abortWatchSession();
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
    el.innerHTML = `
      <div class="movie-poster-wrap">
        ${item.rating ? `<span class="movie-rating">${icon('star', 11, 2)} ${Number(item.rating).toFixed(1)}</span>` : ''}
        <span class="movie-type-badge">${icon(item.type === 'tv' ? 'tv' : 'film', 13, 2.3)}</span>
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
        <span>${item.type === 'tv' ? 'Serial' : 'Film'}</span>
      </div>
    `;
    el.addEventListener('click', () => openDetail(item.id, title, item.type || 'movie'));
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
      card.innerHTML = `
        <img class="banner-bg" loading="lazy" src="${posterUrl(m.poster)}" alt="${escapeHtml(title)}"
             referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='/img/no-poster.svg'">
        <div class="banner-play-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        </div>
        <div class="banner-overlay">
          <span class="banner-tag">${i === 0 ? 'Pilihan Tim' : 'Trending'}</span>
          <div class="banner-title">${escapeHtml(title)}</div>
          <div class="banner-meta">
            <span>${m.release || ''}</span>
            <span>${m.type === 'tv' ? 'Serial' : 'Film'}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => openDetail(m.id, title, m.type || 'movie'));
      strip.appendChild(card);

      const dot = document.createElement('button');
      dot.className = 'banner-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'Slide ' + (i + 1));
      dot.addEventListener('click', () => {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
      dots.appendChild(dot);
    });

    strip.addEventListener('scroll', () => {
      const idx = Math.round(strip.scrollLeft / Math.max(1, (strip.firstElementChild?.offsetWidth || 300) + 16));
      $$('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    }, { passive: true });
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
    const isTv = d.type === 'tv';
    const playbackLabel = isTv ? 'Nonton S1 E1' : 'Putar Film';
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
          ${isTv ? `<span>•</span><span class="meta-ico">${icon('tv', 13, 2.3)} Serial</span>` : ''}
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

    $('#playMainBtn').addEventListener('click', () => {
      if (isTv) playStream(d.id, 'tv', detailSelectedSeason || 1, 1, d.title);
      else playStream(d.id, 'movie', null, null, d.title);
    });

    if (isTv) loadEpisodePicker(d.id);
    else $('#episodePicker').style.display = 'none';
  }

  async function loadEpisodePicker(id) {
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
      detailSelectedSeason = detailSeasons[0].season;
      renderSeasonTabs(id);
      loadEpisodes(id, detailSelectedSeason);
    } catch (e) {
      if (isAbort(e) || token !== detailReq) return;
      box.style.display = 'none';
    }
  }

  function renderSeasonTabs(id) {
    const tabs = $('#seasonTabs');
    tabs.innerHTML = '';
    detailSeasons.forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'season-tab' + (s.season === detailSelectedSeason ? ' active' : '');
      b.textContent = 'S' + s.season + (s.episodes ? ` (${s.episodes})` : '');
      b.dataset.s = s.season;
      b.addEventListener('click', () => {
        detailSelectedSeason = s.season;
        $$('#seasonTabs .season-tab').forEach(x => x.classList.toggle('active', Number(x.dataset.s) === s.season));
        loadEpisodes(id, s.season);
      });
      b.dataset.s = s.season;
      tabs.appendChild(b);
    });
  }

async function loadEpisodes(id, season) {
    const token = ++episodeReq;
    const list = $('#episodeList');
    renderLoading(list, 'Memuat daftar episode...');
    try {
      const res = await Api.tvEpisodes(id, season, signalOf(detailAbort));
      if (token !== episodeReq) return;
      detailEpisodes = res.data || [];
      list.innerHTML = '';
      if (!detailEpisodes.length) {
        noteInto(list, 'empty', 'Belum ada episode untuk musim ini.');
        return;
      }
      detailEpisodes.forEach(ep => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'episode-item';
        el.innerHTML = `
          <span class="episode-num">E${ep.episode}</span>
          <span class="episode-info">
            <span class="episode-name">${escapeHtml(ep.name || 'Episode ' + ep.episode)}</span>
            ${ep.overview ? `<span class="episode-ov">${escapeHtml(ep.overview)}</span>` : ''}
          </span>`;
        el.addEventListener('click', () => {
          playStream(id, 'tv', season, ep.episode, (currentDetail?.title || '') + ' — S' + season + 'E' + ep.episode);
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

  // ── Search ───────────────────────────────────────────────
  function startSearch() {
    const q = $('#searchInput').value.trim();
    if (!q) {
      $('#searchInput').focus();
      $('#searchInput').classList.add('input-error');
      setTimeout(() => $('#searchInput').classList.remove('input-error'), 1600);
      return;
    }
    showView('search');
    if (searchAbort) { try { searchAbort.abort(); } catch (e) {} }
    searchAbort = newAbortController();
    const token = ++searchReq;
    $('#searchResultTitle').textContent = 'Hasil untuk "' + q + '"';
    $('#searchEmpty').style.display = 'none';
    const grid = $('#searchResults');
    grid.innerHTML = renderSkeletonInto(8);
    beginLoading();
    Api.search(q, signalOf(searchAbort)).then(res => {
      if (token !== searchReq) return;
      const items = res.data || [];
      $('#searchCount').textContent = items.length + ' hasil';
      grid.innerHTML = '';
      if (!items.length) {
        noteInto(grid, 'empty', 'Tidak ada hasil untuk "' + q + '". Coba kata kunci lain atau periksa ejaan.');
        return;
      }
      items.forEach(m => grid.appendChild(renderMovieCard(m)));
    }).catch(err => {
      if (isAbort(err) || token !== searchReq) return;
      noteInto(grid, 'error', 'Pencarian gagal. Periksa koneksi internet lalu coba lagi.');
    }).finally(endLoading);
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

    Api.movie(id, type, signal).then(res => {
      if (!isWatchActive(token)) return;
      watchState.detail = res.data || null;
      renderWatchInfo();
    }).catch(() => {});

    loadLikes(id, token, signal);
    loadComments(id, token, signal);
    loadRating(id, token, signal);

    if (watchState.type === 'tv' && season) {
      renderEpisodeStrip(id, season, episode, token, signal);
    } else {
      $('#watchEpisodes').style.display = 'none';
      episodeStripData = { id: null, season: null, episodes: [] };
    }

    try {
      const res = await Api.play(id, type, season, episode, signal);
      if (!isWatchActive(token)) return;
      const stream = res.playlist || {};
      watchState.stream = stream;
      if (!stream.mp4 && !stream.playlist) throw new Error('Tidak ada stream');
      $('#playerStatus').textContent = 'Menemukan sumber stream. Memutar...';
      setupQualities(stream);
      initPlayer(stream, false, token);
    } catch (err) {
      if (isAbort(err) || !isWatchActive(token)) return;
      console.error(err);
      $('#playerStatus').style.display = 'none';
      const errBox = $('#playerError');
      errBox.style.display = '';
      errBox.innerHTML = playerErrorHtml(
        'Sumber video tidak dapat dimuat.',
        'Server sumber sedang tidak merespons atau judul ini belum memiliki tautan video. Coba beberapa saat lagi atau pilih judul lain.'
      );
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
    const video = $('#playerVideo');
    const status = $('#playerStatus');
    const errBox = $('#playerError');
    errBox.style.display = 'none';
    errBox.innerHTML = '';
    status.style.display = '';
    status.innerHTML = `<span class="player-spin">${icon('loader', 18, 2.3)}</span> Menghubungi server streaming...`;
    destroyHls();
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('#watchTitle').textContent = title || 'Memuat...';
    $('#watchSub').innerHTML = '';
    $('#watchDesc').textContent = '';
    $('#watchMeta').innerHTML = '';
    $('#watchAvatarImg').src = '/img/no-poster.svg';
    $('#likeCount').textContent = '0';
    $('#dislikeCount').textContent = '0';
    $('#commentCount').textContent = '0';
    $('#commentCountChip').textContent = '0';
    renderLoading('#commentList', 'Memuat komentar...');
    closeQualityMenu();
    $('#qualityPicker').style.display = 'none';
    $('#watchEpisodes').style.display = 'none';
    $('#watchEpsScroll').innerHTML = '';
    episodeStripData = { id: null, season: null, episodes: [] };
  }

  function setupQualities(stream) {
    const q = stream.qualities || {};
    const keys = Object.keys(q)
      .filter(k => q[k])
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    watchState.qualities = q;

    const menu = $('#qualityMenu');
    menu.innerHTML = '';
    $('#qualityLabel').textContent = 'Auto';

    if (!keys.length && !stream.playlist) {
      watchState.qualityKey = null;
      menu.innerHTML = `<div class="quality-empty">Resolusi unduhan belum tersedia untuk judul ini.</div>`;
      $('#qualityPicker').style.display = '';
      return;
    }

    if (stream.playlist) {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'quality-item quality-play' + (keys.length ? '' : ' active');
      auto.dataset.key = 'auto';
      auto.innerHTML = `<span class="quality-item-res">Auto</span><span class="quality-item-sub">HLS adaptif</span>`;
      auto.addEventListener('click', () => selectQuality('auto'));
      menu.appendChild(auto);
      if (!keys.length) watchState.qualityKey = 'auto';
    }

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

      const dl = document.createElement('a');
      dl.className = 'quality-dl';
      dl.href = '/proxy/hls?url=' + encodeURIComponent(q[k]);
      dl.setAttribute('download', '');
      dl.target = '_blank';
      dl.rel = 'noopener';
      dl.title = `Unduh ${k}p`;
      dl.setAttribute('aria-label', `Unduh ${k}p`);
      dl.innerHTML = icon('download', 15, 2.3);
      row.appendChild(dl);

      menu.appendChild(row);
    });

    if (keys.length) {
      watchState.qualityKey = stream.playlist ? 'auto' : keys[0];
    }
    $('#qualityLabel').textContent = watchState.qualityKey === 'auto' ? 'Auto' : watchState.qualityKey + 'p';
    $('#qualityPicker').style.display = '';
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
      video.src = '/proxy/hls?url=' + encodeURIComponent(watchState.qualities[k]);
      video.addEventListener('loadedmetadata', () => {
        try { video.currentTime = pos || 0; } catch (e) {}
        if (wasPlaying) video.play().catch(() => {});
      }, { once: true });
      video.play().catch(() => {});
      $('#playerStatus').style.display = 'none';
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
      video.src = '/proxy/hls?url=' + encodeURIComponent(mp4);
      video.addEventListener('loadeddata', () => { if (!stale()) $('#playerStatus').style.display = 'none'; }, { once: true });
      video.play().catch((e) => {
        if (stale()) return;
        $('#playerStatus').style.display = 'none';
        $('#playerError').style.display = '';
        $('#playerError').innerHTML = playerErrorHtml(
          'Video gagal diputar.',
          'Browser menolak memutar video ini secara otomatis. Tekan tombol putar pada video, atau pilih resolusi lain.'
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
      video.addEventListener('loadeddata', () => { if (!stale()) $('#playerStatus').style.display = 'none'; }, { once: true });
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
    if (watchState.type !== 'tv' || !watchState.id || !watchState.season || !watchState.episode) return;
    const video = $('#playerVideo');
    const dur = video.duration;
    if (!dur || !isFinite(dur) || dur <= 0) return;
    const ratio = Math.max(0, Math.min(1, video.currentTime / dur));
    const store = loadProgressStore();
    store[progressKey(watchState.id, watchState.season, watchState.episode)] = {
      r: ratio, t: video.currentTime, d: dur, at: Date.now()
    };
    saveProgressStore(store);
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
    const clean = String(base).replace(/\s*—\s*S\d+E\d+\s*$/, '').trim();
    return (clean || 'Episode') + ' — S' + watchState.season + 'E' + ep;
  }

  async function renderEpisodeStrip(id, season, episode, token, signal) {
    const wrap = $('#watchEpisodes');
    const scroll = $('#watchEpsScroll');
    wrap.style.display = '';

    const cacheKey = id + ':' + season;
    let eps = episodeCache.get(cacheKey);
    if (!eps) {
      scroll.innerHTML = '<span class="ep-hint">Memuat episode...</span>';
      try {
        const res = await Api.tvEpisodes(id, season, signal);
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

    episodeStripData = { id, season, episodes: eps };
    if (!eps.length) { wrap.style.display = 'none'; return; }
    scroll.innerHTML = '';
    eps.forEach(ep => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'watch-ep-chip' + (Number(ep.episode) === Number(episode) ? ' active' : '');
      chip.dataset.ep = ep.episode;
      chip.title = 'Episode ' + ep.episode;
      chip.innerHTML = `<span class="watch-ep-chip-num">${ep.episode}</span><span class="watch-ep-chip-bar"></span>`;
      chip.addEventListener('click', () => {
        if (Number(ep.episode) === Number(watchState.episode)) return;
        playStream(id, 'tv', season, ep.episode, stripTitleFor(ep.episode));
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
    $('#miniTitle').textContent = title || 'Memutar...';

    const avatar = $('#watchAvatarImg');
    if (d.poster) {
      avatar.src = posterUrl(d.poster);
      avatar.onerror = () => { avatar.onerror = null; avatar.src = '/img/no-poster.svg'; };
    } else {
      avatar.src = '/img/no-poster.svg';
    }

    const parts = [];
    if (d.duration) parts.push(escapeHtml(d.duration));
    if (d.release) parts.push(escapeHtml(d.release));
    if (d.rating) parts.push(`<span class="rating">${icon('star', 12, 2.3)} ${Number(d.rating).toFixed(1)}</span>`);
    if (watchState.type === 'tv') parts.push(`<span class="meta-ico">${icon('tv', 13, 2.3)} Serial</span>`);
    $('#watchSub').innerHTML = parts.join('<span class="dot-sep">•</span>');

    $('#watchDesc').textContent = d.overview || 'Belum ada deskripsi untuk judul ini.';

    const chips = [];
    if (d.genre) chips.push({ label: 'Genre', value: d.genre });
    if (d.network) chips.push({ label: 'Network', value: d.network });
    if (d.certification) chips.push({ label: 'Rating Usia', value: d.certification });
    if (watchState.type === 'tv') chips.push({ label: 'Episode', value: `S${watchState.season || 1} E${watchState.episode || 1}` });
    $('#watchMeta').innerHTML = chips.map(c =>
      `<div class="fact-cell"><div class="fact-label">${escapeHtml(c.label)}</div><div class="fact-value">${escapeHtml(c.value)}</div></div>`
    ).join('');
  }

  // ── Likes ────────────────────────────────────────────────
  function loadLikes(id, token, signal) {
    Api.likes(id, signal).then(res => {
      if (!isWatchActive(token)) return;
      watchState.likes = { likes: res.likes || 0, dislikes: res.dislikes || 0 };
      renderLikes();
    }).catch(() => {});
  }

  function renderLikes() {
    $('#likeCount').textContent = watchState.likes.likes;
    $('#dislikeCount').textContent = watchState.likes.dislikes;
    $('#likeBtn').classList.toggle('voted', watchState.myVote === 1);
    $('#dislikeBtn').classList.toggle('voted', watchState.myVote === -1);
  }

  // Umpan balik halus di dalam watch view (pengganti notifikasi)
  let feedbackTimer = null;
  function showFeedback(kind, message) {
    const el = $('#watchFeedback');
    if (!el) return;
    const ico = kind === 'error' ? 'alert-triangle' : kind === 'success' ? 'check' : 'info';
    el.className = 'watch-feedback ' + kind;
    el.innerHTML = `<span class="watch-feedback-ico">${icon(ico, 15, 2.3)}</span><span>${escapeHtml(message)}</span>`;
    el.style.display = 'flex';
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
  }

  function vote(dir) {
    const id = watchState.id;
    if (!id || watchState.myVote === dir) return;
    const payload = {};
    if (dir === 1) payload.like = 1; else payload.dislike = 1;
    if (watchState.myVote === 1) payload.like = -1;
    if (watchState.myVote === -1) payload.dislike = -1;
    Api.like(id, payload).then(res => {
      watchState.likes = { likes: res.likes, dislikes: res.dislikes };
      watchState.myVote = dir;
      renderLikes();
      showFeedback('success', dir === 1 ? 'Kamu menyukai judul ini.' : 'Kamu tidak menyukai judul ini.');
    }).catch(() => showFeedback('error', 'Gagal menyimpan like. Periksa koneksi lalu coba lagi.'));
  }

  // ── Rating Poll ──────────────────────────────────────────
  function loadRating(id, token, signal) {
    Api.ratings(id, signal).then(res => {
      if (!isWatchActive(token)) return;
      watchState.rating = res;
      renderRating();
    }).catch(() => {});
  }

  function starsHtml(filled, total = 5, size = 14) {
    let h = '';
    for (let i = 1; i <= total; i++) {
      h += `<span class="star-ico${i <= filled ? ' on' : ''}">${icon('star', size, 2.2)}</span>`;
    }
    return h;
  }

  function renderRating() {
    const r = watchState.rating || { average: 0, total: 0, counts: {}, distribution: {} };
    $('#ratingAvg').textContent = (r.average || 0).toFixed(1);
    $('#ratingTotal').textContent = (r.total || 0) + ' suara';
    const filled = Math.round(r.average || 0);
    $('#ratingAvgStars').innerHTML = starsHtml(filled, 5, 14);

    $$('#ratingStars .star-btn').forEach(b => {
      b.innerHTML = icon('star', 22, 2);
    });

    const bars = $('#ratingBars');
    bars.innerHTML = '';
    for (let s = 5; s >= 1; s--) {
      const pct = (r.distribution && r.distribution[s]) || 0;
      const cnt = (r.counts && r.counts[s]) || 0;
      bars.insertAdjacentHTML('beforeend', `
        <div class="rating-bar-row">
          <span class="rating-bar-label">${s}${icon('star', 10, 2.4)}</span>
          <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${pct}%"></div></div>
          <span class="rating-bar-count">${cnt}</span>
        </div>`);
    }
    $$('#ratingStars .star-btn').forEach(b => {
      b.classList.toggle('picked', Number(b.dataset.score) <= watchState.myRating);
    });
  }

  function submitRating(score) {
    const id = watchState.id;
    if (!id) return;
    watchState.myRating = score;
    Api.rate(id, score).then(res => {
      watchState.rating = res;
      renderRating();
      showFeedback('success', 'Rating ' + score + ' bintang berhasil dikirim.');
    }).catch(() => showFeedback('error', 'Gagal mengirim rating. Periksa koneksi lalu coba lagi.'));
  }

  // ── Comments ─────────────────────────────────────────────
  function loadComments(id, token, signal) {
    renderLoading('#commentList', 'Memuat komentar...');
    Api.comments(id, signal).then(res => {
      if (!isWatchActive(token)) return;
      renderComments(res);
    }).catch(err => {
      if (isAbort(err) || !isWatchActive(token)) return;
      noteInto('#commentList', 'error', 'Gagal memuat komentar. Periksa koneksi lalu coba lagi.');
    });
  }

  function renderComments(res) {
    const list = (res && res.data) || [];
    const count = (res && res.count) || list.length;
    $('#commentCount').textContent = count;
    $('#commentCountChip').textContent = count;
    const box = $('#commentList');
    if (!list.length) {
      noteInto(box, 'empty', 'Belum ada komentar. Jadilah yang pertama berkomentar.');
      return;
    }
    box.innerHTML = '';
    list.forEach(c => {
      const el = document.createElement('div');
      el.className = 'comment-item';
      el.innerHTML = `
        <div class="comment-avatar">${escapeHtml((c.name || 'A').trim().charAt(0).toUpperCase())}</div>
        <div class="comment-body">
          <div class="comment-head">
            <span class="comment-author">${escapeHtml(c.name || 'Pengguna Anonim')}</span>
            <span class="comment-time">${timeAgo(c.createdAt)}</span>
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
        </div>`;
      box.appendChild(el);
    });
  }

  function submitComment(e) {
    e.preventDefault();
    const id = watchState.id;
    if (!id) return;
    const text = $('#commentText').value.trim();
    if (!text) {
      $('#commentText').focus();
      $('#commentText').classList.add('input-error');
      setTimeout(() => $('#commentText').classList.remove('input-error'), 1600);
      return;
    }
    const btn = $('#commentSendBtn');
    btn.disabled = true;
    Api.addComment(id, { name: $('#commentName').value.trim(), text }).then(() => {
      $('#commentText').value = '';
      loadComments(id);
      showFeedback('success', 'Komentar berhasil dikirim.');
    }).catch(() => showFeedback('error', 'Gagal mengirim komentar. Periksa koneksi lalu coba lagi.'))
      .finally(() => { btn.disabled = false; });
  }

  function timeAgo(ts) {
    const diff = Math.max(0, Date.now() - (ts || 0));
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'baru saja';
    if (m < 60) return m + ' menit lalu';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' jam lalu';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' hari lalu';
    return new Date(ts).toLocaleDateString('id-ID');
  }

function closePlayer() {
    setWatchProgress();
    closeQualityMenu();
    destroyHls();
    const v = $('#playerVideo');
    v.pause();
    v.removeAttribute('src');
    v.load();
    watchState.id = null;
    watchState.myVote = 0;
    watchState.myRating = 0;
    showView('home');
  }

  function toggleQualityMenu() {
    const menu = $('#qualityMenu');
    const open = menu.classList.toggle('open');
    $('#qualityPicker').classList.toggle('menu-open', open);
  }
  function closeQualityMenu() {
    $('#qualityMenu').classList.remove('open');
    $('#qualityPicker').classList.remove('menu-open');
  }

  // ── Events ───────────────────────────────────────────────
  function wireEvents() {
    $('#headerLogo').addEventListener('click', () => {
      if (currentView !== 'home') loadHome();
      showView('home');
    });

    $('#searchBtn').addEventListener('click', startSearch);
    $('#searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startSearch();
    });
    $('#headerSearchBtn').addEventListener('click', () => {
      showView('home');
      setTimeout(() => $('#searchInput').focus(), 60);
    });

    $('#headerRefreshBtn').addEventListener('click', () => {
      loadHome();
    });

    $('#loadMoreBtn').addEventListener('click', loadMore);

    $('#playerBackBtn').addEventListener('click', () => { closePlayer(); });

    // Progres tontonan untuk strip episode (throttle 4s + saat jeda/selesai)
    let lastProgressSave = 0;
    const playerVideo = $('#playerVideo');
    playerVideo.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastProgressSave < 4000) return;
      lastProgressSave = now;
      setWatchProgress();
      updateEpisodeBars();
    });
    playerVideo.addEventListener('pause', () => { setWatchProgress(); updateEpisodeBars(); });
    playerVideo.addEventListener('ended', () => { setWatchProgress(); updateEpisodeBars(); });

    $('#qualityToggle').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleQualityMenu();
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#qualityPicker')) closeQualityMenu();
    });

    $('#likeBtn').addEventListener('click', () => vote(1));
    $('#dislikeBtn').addEventListener('click', () => vote(-1));
    $('#commentScrollBtn').addEventListener('click', () => {
      $('#watchComments').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#commentText').focus(), 300);
    });
    $('#commentForm').addEventListener('submit', submitComment);

    $$('#ratingStars .star-btn').forEach(b => {
      b.innerHTML = icon('star', 22, 2);
      b.addEventListener('click', () => submitRating(Number(b.dataset.score)));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($('#qualityMenu').classList.contains('open')) { closeQualityMenu(); return; }
        if (currentView === 'watch') closePlayer();
      }
    });

    window.__goHome = () => { showView('home'); };
    window.__retryLast = () => {
      playStream(watchState.id, watchState.type, watchState.season, watchState.episode, watchState.title);
    };
  }

  // ── Boot ────────────────────────────────────────────────
  loadHome();
  wireEvents();
  showView('home');
})();