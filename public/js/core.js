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

  // ── Toast ────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg) {
    const t = $('#neuToast');
    $('#toastMsg').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── View Switching ───────────────────────────────────────
  function showView(name) {
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
        ${item.rating ? `<span class="movie-rating">★ ${Number(item.rating).toFixed(1)}</span>` : ''}
        <span class="movie-type-badge">${item.type === 'tv' ? '📺' : '🎬'}</span>
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
    try {
      const res = await Api.categories();
      categories = res.data || [];
      renderCategoryTabs();
    } catch (err) {
      categories = [{ id: 'trending', label: '🔥 Trending', realtime: false }];
      renderCategoryTabs();
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
      b.textContent = c.label;
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
    catalogState.page = 1;
    catalogState.hasMore = true;
    seenKeys = new Set();
    try {
      const res = await Api.catalog(catId, 1);
      const movies = res.data || [];
      const cat = categories.find(c => c.id === catId) || {};
      $('#sectionLabel').textContent = res.label || cat.label || 'Daftar';
      $('#liveBadge').style.display = res.realtime ? 'inline-flex' : 'none';

      const grid = $('#moviesGrid');
      grid.innerHTML = '';
      movies.forEach(m => appendCard(grid, m));
      $('#sectionCount').textContent = seenKeys.size + ' judul';
      if (movies.length === 0) {
        grid.innerHTML = '<div class="search-hero-hint" style="grid-column:1/-1;">Belum ada data. Coba muat ulang.</div>';
      }
      catalogState.hasMore = movies.length > 0;

      if (res.realtime) startRealtime(catId);
    } catch (err) {
      console.error(err);
      $('#moviesGrid').innerHTML = '<div class="search-hero-hint" style="grid-column:1/-1;">Gagal memuat data. Periksa koneksi & server.</div>';
      showToast('Gagal memuat: ' + err.message);
    }
    updateLoadMore();
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
    const btn = $('#loadMoreBtn');
    const label = $('#loadMoreLabel');
    const prev = label.textContent;
    btn.classList.add('loading');
    label.textContent = 'Memuat...';
    const next = catalogState.page + 1;
    try {
      const res = await Api.catalog(activeCategory, next);
      const movies = res.data || [];
      const grid = $('#moviesGrid');
      const before = seenKeys.size;
      movies.forEach(m => appendCard(grid, m));
      const added = seenKeys.size - before;
      catalogState.page = next;
      $('#sectionCount').textContent = seenKeys.size + ' judul';
      if (movies.length === 0 || added === 0) {
        catalogState.hasMore = false;
        showToast('Semua judul sudah ditampilkan');
      } else {
        showToast('+' + added + ' judul ditambahkan');
      }
    } catch (err) {
      console.error(err);
      showToast('Gagal memuat halaman berikutnya');
    } finally {
      catalogState.loading = false;
      btn.classList.remove('loading');
      label.textContent = prev;
      updateLoadMore();
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
        showToast('🔄 ' + (res.label || 'Konten') + ' diperbarui');
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
    showView('detail');
    showToast('Memuat detail...');
    const hero = $('#detailHero');
    hero.innerHTML = `<div class="skeleton-shimmer-box" style="width:100%;height:300px;border-radius:20px;"></div>`;
    $('#episodePicker').style.display = 'none';
    try {
      const res = await Api.movie(id, type);
      currentDetail = res.data;
      renderDetail(currentDetail);
    } catch (err) {
      console.error(err);
      renderDetailFallback(id, fallbackTitle, type);
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
    $('#detailOverview').innerHTML = '<div class="overview-label">Detail</div><p class="detail-description">Detail tidak tersedia, tapi kamu tetap bisa menonton.</p>';
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
          ${d.rating ? `<span class="rating">★ ${Number(d.rating).toFixed(1)}</span>` : ''}
          ${isTv ? '<span>•</span><span>Serial 📺</span>' : ''}
        </div>
        <div class="detail-actions">
          <button class="tactile-btn primary" id="playMainBtn">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${playbackLabel}
          </button>
          <button class="tactile-btn" onclick="window.__goHome()" id="backMainBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Beranda
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
         ${fact('Rating', d.rating ? '★ ' + Number(d.rating).toFixed(1) : '—')}
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
    try {
      const sres = await Api.tvSeasons(id);
      detailSeasons = sres.data || [];
      if (!detailSeasons.length) {
        box.style.display = 'none';
        return;
      }
      detailSelectedSeason = detailSeasons[0].season;
      renderSeasonTabs(id);
      loadEpisodes(id, detailSelectedSeason);
    } catch (e) {
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
    const list = $('#episodeList');
    list.innerHTML = '<span class="ep-hint">Memuat episode…</span>';
    try {
      const res = await Api.tvEpisodes(id, season);
      detailEpisodes = res.data || [];
      list.innerHTML = '';
      if (!detailEpisodes.length) {
        list.innerHTML = '<span class="ep-hint">Tidak ada episode.</span>';
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
      list.innerHTML = '<span class="ep-hint">Gagal memuat episode.</span>';
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
    return [
      { label: 'Skor Rotten', value: r ? `${Math.round(r * 10)}% 🍅` : '—' },
      { label: 'Potensi Nonton', value: r >= 7.5 ? '🟢 Tinggi' : r >= 6 ? '🟡 Sedang' : '🔴 Rendah' },
      { label: 'Prediksi Rating', value: r ? `★ ${Math.min(10, r + 0.3).toFixed(1)}` : '—' },
      { label: 'Kategori Umur', value: d.adult ? 'Dewasa (18+)' : 'Semua Umur' },
      { label: 'Popularitas', value: year >= new Date().getFullYear() - 1 ? '🔥 Baru rilis' : 'Tayang lama' }
    ];
  }

  // ── Search ───────────────────────────────────────────────
  function startSearch() {
    const q = $('#searchInput').value.trim();
    if (!q) { showToast('Ketik judul film terlebih dahulu'); return; }
    showView('search');
    $('#searchResultTitle').textContent = 'Hasil untuk "' + q + '"';
    $('#searchEmpty').style.display = 'none';
    const grid = $('#searchResults');
    grid.innerHTML = renderSkeletonInto(8);
    Api.search(q).then(res => {
      const items = res.data || [];
      $('#searchCount').textContent = items.length + ' hasil';
      grid.innerHTML = '';
      if (!items.length) { grid.innerHTML = '<div class="search-hero-hint" style="grid-column:1/-1;">Tidak ada hasil untuk "' + escapeHtml(q) + '".</div>'; return; }
      items.forEach(m => grid.appendChild(renderMovieCard(m)));
    }).catch(() => {
      grid.innerHTML = '<div class="search-hero-hint" style="grid-column:1/-1;">Pencarian gagal.</div>';
    });
  }

  function renderSkeletonInto(n) {
    let h = '';
    for (let i = 0; i < n; i++) h += `<div class="skeleton-card"><div class="skeleton-shimmer-box skeleton-poster"></div></div>`;
    return h;
  }

  // ── Playback (Full Page Watch View) ──────────────────────
  async function playStream(id, type, season, episode, title) {
    exitMini();
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

    Api.movie(id, type).then(res => {
      watchState.detail = res.data || null;
      renderWatchInfo();
    }).catch(() => {});

    loadLikes(id);
    loadComments(id);
    loadRating(id);

    try {
      const res = await Api.play(id, type, season, episode);
      const stream = res.playlist || {};
      watchState.stream = stream;
      if (!stream.mp4 && !stream.playlist) throw new Error('Tidak ada stream');
      $('#playerStatus').textContent = 'Menemukan sumber stream. Memutar…';
      setupQualities(stream);
      initPlayer(stream);
    } catch (err) {
      console.error(err);
      $('#playerStatus').style.display = 'none';
      const errBox = $('#playerError');
      errBox.style.display = '';
      errBox.innerHTML = '❌ Gagal memuat stream. Coba judul lain atau muat ulang halaman.<br><br>' +
        '<button class="tactile-btn" style="font-size:0.82rem;padding:10px 16px" onclick="window.__retryLast()">Coba Lagi</button>';
    }
  }

  function resetPlayerUI(title) {
    const video = $('#playerVideo');
    const status = $('#playerStatus');
    const errBox = $('#playerError');
    errBox.style.display = 'none';
    errBox.innerHTML = '';
    status.style.display = '';
    status.textContent = 'Menghubungi server streaming…';
    destroyHls();
    video.pause();
    video.removeAttribute('src');
    video.load();
    $('#watchTitle').textContent = title || 'Memuat…';
    $('#watchSub').innerHTML = '';
    $('#watchDesc').textContent = '';
    $('#watchMeta').innerHTML = '';
    $('#likeCount').textContent = '0';
    $('#dislikeCount').textContent = '0';
    $('#commentCount').textContent = '0';
    $('#commentCountChip').textContent = '0';
    $('#commentList').innerHTML = '<div class="search-hero-hint">Memuat komentar…</div>';
    closeQualityMenu();
    $('#qualityPicker').style.display = 'none';
  }

  function setupQualities(stream) {
    const q = stream.qualities || {};
    const keys = Object.keys(q)
      .filter(k => q[k])
      .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
    watchState.qualities = q;
    if (!keys.length) {
      watchState.qualityKey = null;
      $('#qualityPicker').style.display = 'none';
      return;
    }
    watchState.qualityKey = keys[0];
    $('#qualityLabel').textContent = keys[0] + 'p';
    const menu = $('#qualityMenu');
    menu.innerHTML = '';
    keys.forEach(k => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quality-item' + (k === keys[0] ? ' active' : '');
      b.textContent = k + 'p';
      b.dataset.key = k;
      b.addEventListener('click', () => selectQuality(k));
      menu.appendChild(b);
    });
    if (stream.playlist) {
      const auto = document.createElement('button');
      auto.type = 'button';
      auto.className = 'quality-item';
      auto.textContent = 'Auto (HLS)';
      auto.dataset.key = 'auto';
      auto.addEventListener('click', () => selectQuality('auto'));
      menu.appendChild(auto);
    }
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
      initPlayer(stream, true);
    }
  }

  function initPlayer(stream, forceHls) {
    destroyHls();
    const video = $('#playerVideo');
    const mp4 = stream.mp4;

    if (mp4 && !forceHls) {
      video.src = '/proxy/hls?url=' + encodeURIComponent(mp4);
      video.addEventListener('loadeddata', () => { $('#playerStatus').style.display = 'none'; }, { once: true });
      video.play().catch((e) => {
        $('#playerStatus').style.display = 'none';
        $('#playerError').style.display = '';
        $('#playerError').textContent = 'Gagal memutar video: ' + e.message;
      });
      return;
    }

    const playlistUrl = stream.playlist;
    if (!playlistUrl) {
      $('#playerStatus').style.display = 'none';
      if (!$('#playerVideo').currentSrc) {
        $('#playerError').style.display = '';
        $('#playerError').textContent = 'Tidak ada sumber stream yang bisa diputar.';
      }
      return;
    }

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, enableWorker: true, manifestLoadingTimeOut: 20000 });
      hls.loadSource('/proxy/hls?url=' + encodeURIComponent(playlistUrl));
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        $('#playerStatus').style.display = 'none';
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { showToast('Network error, mencoba lagi…'); hls.startLoad(); }
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); }
          else {
            $('#playerStatus').style.display = 'none';
            $('#playerError').style.display = '';
            $('#playerError').textContent = 'Terjadi error saat memutar stream.';
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = '/proxy/hls?url=' + encodeURIComponent(playlistUrl);
      video.addEventListener('loadeddata', () => { $('#playerStatus').style.display = 'none'; }, { once: true });
      video.play().catch(() => {});
    } else {
      $('#playerError').style.display = '';
      $('#playerError').textContent = 'Browser tidak mendukung HLS.';
    }
  }

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
  }

  // ── Watch Info ───────────────────────────────────────────
  function renderWatchInfo() {
    const d = watchState.detail || {};
    const title = d.title || d.name || watchState.title;
    $('#watchTitle').textContent = title || 'Tanpa Judul';
    $('#miniTitle').textContent = title || 'Memutar…';

    const parts = [];
    if (d.release) parts.push(escapeHtml(extractYear(d.release) || d.release));
    if (d.duration) parts.push(escapeHtml(d.duration));
    if (d.rating) parts.push(`<span class="rating">★ ${Number(d.rating).toFixed(1)}</span>`);
    if (watchState.type === 'tv') parts.push('Serial 📺');
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
  function loadLikes(id) {
    Api.likes(id).then(res => {
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
      showToast(dir === 1 ? '👍 Kamu menyukai ini' : '👎 Kamu tidak menyukai ini');
    }).catch(err => showToast('Gagal: ' + err.message));
  }

  // ── Rating Poll ──────────────────────────────────────────
  function loadRating(id) {
    Api.ratings(id).then(res => {
      watchState.rating = res;
      renderRating();
    }).catch(() => {});
  }

  function renderRating() {
    const r = watchState.rating || { average: 0, total: 0, counts: {}, distribution: {} };
    $('#ratingAvg').textContent = (r.average || 0).toFixed(1);
    $('#ratingTotal').textContent = (r.total || 0) + ' suara';
    const filled = Math.round(r.average || 0);
    $('#ratingAvgStars').textContent = '★'.repeat(filled) + '☆'.repeat(5 - filled);

    const bars = $('#ratingBars');
    bars.innerHTML = '';
    for (let s = 5; s >= 1; s--) {
      const pct = (r.distribution && r.distribution[s]) || 0;
      const cnt = (r.counts && r.counts[s]) || 0;
      bars.insertAdjacentHTML('beforeend', `
        <div class="rating-bar-row">
          <span class="rating-bar-label">${s}★</span>
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
      showToast('⭐ Rating ' + score + ' bintang terkirim');
    }).catch(err => showToast('Gagal: ' + err.message));
  }

  // ── Comments ─────────────────────────────────────────────
  function loadComments(id) {
    Api.comments(id).then(renderComments).catch(() => {
      $('#commentList').innerHTML = '<div class="search-hero-hint">Gagal memuat komentar.</div>';
    });
  }

  function renderComments(res) {
    const list = (res && res.data) || [];
    const count = (res && res.count) || list.length;
    $('#commentCount').textContent = count;
    $('#commentCountChip').textContent = count;
    const box = $('#commentList');
    if (!list.length) {
      box.innerHTML = '<div class="search-hero-hint">Belum ada komentar. Jadilah yang pertama!</div>';
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
    if (!text) { showToast('Tulis komentar dulu'); return; }
    const btn = $('#commentSendBtn');
    btn.disabled = true;
    Api.addComment(id, { name: $('#commentName').value.trim(), text }).then(() => {
      $('#commentText').value = '';
      loadComments(id);
      showToast('Komentar terkirim');
    }).catch(err => showToast('Gagal: ' + err.message))
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

  // ── Fullscreen & Minimize ────────────────────────────────
  function toggleFullscreen() {
    const video = $('#playerVideo');
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const fn = video.requestFullscreen || video.webkitRequestFullscreen || video.webkitEnterFullscreen;
    if (fn) {
      const r = fn.call(video);
      if (r && r.catch) r.catch(() => showToast('Layar penuh tidak didukung browser ini'));
    } else {
      showToast('Layar penuh tidak didukung browser ini');
    }
  }

  function updateFullscreenIcon() {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const span = $('#playerFullscreenBtn')?.querySelector('span');
    if (span) span.textContent = fs ? 'Keluar' : 'Layar Penuh';
  }

  function enterMini() {
    const video = $('#playerVideo');
    const slot = $('#miniVideoSlot');
    slot.appendChild(video);
    $('#miniPlayer').classList.add('open');
    $('#miniTitle').textContent = $('#watchTitle').textContent || 'Memutar…';
    showView('home');
  }

  function exitMini() {
    const mini = $('#miniPlayer');
    if (!mini.classList.contains('open')) return;
    mini.classList.remove('open');
    const video = $('#playerVideo');
    const wrap = $('.watch-video-wrap');
    if (wrap && video.parentElement !== wrap) wrap.insertBefore(video, wrap.firstChild);
  }

  function closePlayer() {
    exitMini();
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

  function toggleQualityMenu() { $('#qualityMenu').classList.toggle('open'); }
  function closeQualityMenu() { $('#qualityMenu').classList.remove('open'); }

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
      showToast('Data disegarkan');
    });

    $('#loadMoreBtn').addEventListener('click', loadMore);

    $('#playerBackBtn').addEventListener('click', () => { closePlayer(); });
    $('#playerFullscreenBtn').addEventListener('click', toggleFullscreen);
    $('#playerMinimizeBtn').addEventListener('click', () => { enterMini(); });
    $('#miniRestoreBtn').addEventListener('click', () => {
      showView('watch');
      exitMini();
    });
    $('#miniCloseBtn').addEventListener('click', closePlayer);

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
      b.addEventListener('click', () => submitRating(Number(b.dataset.score)));
    });

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if ($('#qualityMenu').classList.contains('open')) { closeQualityMenu(); return; }
        if (currentView === 'watch') closePlayer();
        else if ($('#miniPlayer').classList.contains('open')) closePlayer();
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