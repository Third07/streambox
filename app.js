'use strict';

const CONFIG = {
  API_BASE: '/api/tmdb',
  REGION: 'PH',
  IMAGE_BASE: 'https://image.tmdb.org/t/p/',
  REQUEST_TIMEOUT: 12000,
  CACHE_LIMIT: 180,
  CACHE_TTL: 15 * 60 * 1000,
  LONG_CACHE_TTL: 24 * 60 * 60 * 1000
};

const PLAYER_SOURCES = {
  movie: [
    { id: 'vidlove', name: 'VidLove', origin: 'https://player.vidlove.cc', base: 'https://player.vidlove.cc/embed/movie/', events: true, externalSeek: true },
    { id: 'vidlink', name: 'VidLink', origin: 'https://vidlink.pro', base: 'https://vidlink.pro/movie/', events: true },    
    { id: 'vidrock', name: 'VidRock', origin: 'https://vidrock.net', base: 'https://vidrock.net/movie/' },
    { id: 'vidsrc-io', name: 'VidSrc IO', origin: 'https://vidsrc.io', base: 'https://vidsrc.io/embed/movie/' },
    { id: '111movies', name: '111Movies', origin: 'https://111movies.net', base: 'https://111movies.net/movie/' }
  ],
  tv: [
    { id: 'vidlink', name: 'VidLink', badge: 'Recommended', provider: 'vidlink', origin: 'https://vidlink.pro', base: 'https://vidlink.pro/tv/', events: true },
    { id: 'vidlove', name: 'VidLove', badge: 'New', provider: 'vidlove', origin: 'https://player.vidlove.cc', base: 'https://player.vidlove.cc/embed/tv/', events: true, externalSeek: true },
    { id: 'videasy', name: 'Videasy', origin: 'https://player.videasy.net', base: 'https://player.videasy.net/tv/' },
    { id: 'vidrock', name: 'VidRock', origin: 'https://vidrock.net', base: 'https://vidrock.net/tv/' },
    { id: 'vidsrc-io', name: 'VidSrc IO', origin: 'https://vidsrc.io', base: 'https://vidsrc.io/embed/tv/' },
    { id: '111movies', name: '111Movies', origin: 'https://111movies.net', base: 'https://111movies.net/tv/' }
  ]
};

const STORAGE_KEYS = {
  watchlist: 'streambox.watchlist',
  history: 'streambox.history',
  sources: 'streambox.playback.sources'
};

const ICONS = {
  play: '<path d="m9 7 8 5-8 5Z"></path>',
  bookmark: '<path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z"></path>',
  bookmarkFilled: '<path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4Z" fill="currentColor"></path>',
  external: '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"></path>',
  left: '<path d="m15 18-6-6 6-6"></path>',
  right: '<path d="m9 18 6-6-6-6"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
  close: '<path d="m6 6 12 12M18 6 6 18"></path>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"></path>',
  retry: '<path d="M20 7v5h-5M4 17v-5h5"></path><path d="M6.1 9a7 7 0 0 1 11.7-2L20 9M4 15l2.2 2a7 7 0 0 0 11.7-2"></path>'
};

const state = {
  cache: new Map(),
  watchlist: [],
  history: [],
  sourcePreferences: { movie: '', tv: '' },
  renderToken: 0,
  currentMediaKey: '',
  currentServer: 0,
  currentSeason: 1,
  currentEpisode: 1,
  menuOpen: false,
  toastTimer: 0,
  playerLoadTimer: 0,
  playerSession: 0,
  activePlayerData: null,
  playerProgress: { watched: 0, duration: 0 },
  lastProgressSavedAt: 0
};

const el = (selector, parent = document) => parent.querySelector(selector);
const els = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function toInteger(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function validId(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? text : '';
}

function mediaTypeOf(item, fallback = 'movie') {
  if (item?.media_type === 'tv') return 'tv';
  if (item?.media_type === 'movie') return 'movie';
  if (item?.first_air_date || item?.name) return 'tv';
  return fallback === 'tv' ? 'tv' : 'movie';
}

function mediaKey(item, fallbackType) {
  return `${mediaTypeOf(item, fallbackType)}:${validId(item?.id)}`;
}

function titleOf(item) {
  return item?.title || item?.name || item?.original_title || item?.original_name || 'Untitled';
}

function isAnime(item) {
  const genreIds = Array.isArray(item?.genre_ids) ? item.genre_ids.map(Number) : [];
  const detailGenres = Array.isArray(item?.genres) ? item.genres.map(genre => Number(genre?.id)) : [];
  return item?.original_language === 'ja' && (genreIds.includes(16) || detailGenres.includes(16));
}

function yearOf(item) {
  const date = item?.release_date || item?.first_air_date || '';
  return /^\d{4}/.test(date) ? date.slice(0, 4) : '';
}

function initialOf(value) {
  const match = String(value || '').trim().match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : 'S';
}

function imgUrl(path, size = 'w342') {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9._/-]+$/.test(path)) return '';
  return `${CONFIG.IMAGE_BASE}${size}${path}`;
}

function imageSrcset(path, sizes) {
  if (!imgUrl(path)) return '';
  return sizes.map(([size, width]) => `${imgUrl(path, size)} ${width}w`).join(', ');
}

function hashHref(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      query.set(key, String(value));
    }
  });
  const suffix = query.toString();
  return `#${path}${suffix ? `?${suffix}` : ''}`;
}

function watchHref(item, fallbackType) {
  const id = validId(item?.id);
  if (!id) return '#/home';
  const type = mediaTypeOf(item, fallbackType);
  const params = { type, id };
  if (type === 'tv') {
    if (item?.season !== undefined && toInteger(item.season, -1) >= 0) params.season = toInteger(item.season);
    if (item?.episode !== undefined && toInteger(item.episode, 0) > 0) params.episode = toInteger(item.episode);
  }
  if (typeof item?.source === 'string' && item.source) params.source = item.source;
  return hashHref('/watch', params);
}

function setDocumentTitle(label = '') {
  document.title = label ? `${label} — Streambox` : 'Streambox — Discover Movies & TV Series';
}

function toast(message) {
  const node = el('#toast');
  if (!node) return;
  window.clearTimeout(state.toastTimer);
  node.textContent = message;
  node.classList.add('show');
  state.toastTimer = window.setTimeout(() => node.classList.remove('show'), 2600);
}

function setAppBusy(isBusy) {
  const app = el('#app');
  if (app) app.setAttribute('aria-busy', String(Boolean(isBusy)));
}

function isCurrentRender(token) {
  return token === state.renderToken;
}

function safeStoredArray(primaryKey, legacyKey) {
  try {
    const raw = localStorage.getItem(primaryKey) || (legacyKey ? localStorage.getItem(legacyKey) : '');
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    const seen = new Set();
    return parsed.filter(item => {
      if (!item || !validId(item.id)) return false;
      item.media_type = mediaTypeOf(item);
      const key = mediaKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 80);
  } catch (error) {
    console.warn(`Stored data could not be read: ${primaryKey}`, error);
    return [];
  }
}

function loadLocalState() {
  state.watchlist = safeStoredArray(STORAGE_KEYS.watchlist, 'watchlist');
  state.history = safeStoredArray(STORAGE_KEYS.history, 'history');
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.sources) || '{}');
    state.sourcePreferences.movie = typeof stored.movie === 'string' ? stored.movie : '';
    state.sourcePreferences.tv = typeof stored.tv === 'string' ? stored.tv : '';
  } catch (error) {
    console.warn('Playback preferences could not be read.', error);
  }
}

function saveCollections() {
  try {
    localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify(state.watchlist));
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(state.history));
  } catch (error) {
    console.warn('Watch data could not be saved.', error);
    toast('This browser could not save your changes.');
  }
}

function saveSourcePreference(type, sourceId) {
  if (!PLAYER_SOURCES[type]?.some(source => source.id === sourceId)) return;
  state.sourcePreferences[type] = sourceId;
  try {
    localStorage.setItem(STORAGE_KEYS.sources, JSON.stringify(state.sourcePreferences));
  } catch (error) {
    console.warn('Playback preference could not be saved.', error);
  }
}

function inWatchlist(item) {
  const key = mediaKey(item);
  return Boolean(key.split(':')[1]) && state.watchlist.some(saved => mediaKey(saved) === key);
}

function savedMediaItem(item, includeProgress = false) {
  const existing = state.history.find(saved => mediaKey(saved) === mediaKey(item));
  const saved = {
    id: Number(validId(item.id)),
    media_type: mediaTypeOf(item),
    title: titleOf(item),
    poster_path: item.poster_path || '',
    backdrop_path: item.backdrop_path || '',
    release_date: item.release_date || '',
    first_air_date: item.first_air_date || '',
    vote_average: Number(item.vote_average) || 0,
    timestamp: Date.now()
  };

  if (includeProgress && saved.media_type === 'tv') {
    saved.season = state.currentSeason;
    saved.episode = state.currentEpisode;
  }
  if (includeProgress) {
    saved.source = currentSource(saved.media_type)?.id || '';
    const progressMatches = saved.media_type !== 'tv'
      || (toInteger(existing?.season, -1) === state.currentSeason && toInteger(existing?.episode, -1) === state.currentEpisode);
    const watched = Number(state.playerProgress.watched);
    const duration = Number(state.playerProgress.duration);
    if (Number.isFinite(watched) && watched > 0) saved.watched = Math.round(watched * 10) / 10;
    else if (progressMatches && Number(existing?.watched) > 0) saved.watched = Number(existing.watched);
    if (Number.isFinite(duration) && duration > 0) saved.duration = Math.round(duration * 10) / 10;
    else if (progressMatches && Number(existing?.duration) > 0) saved.duration = Number(existing.duration);
  }
  return saved;
}

function toggleWatchlist(item) {
  const key = mediaKey(item);
  const index = state.watchlist.findIndex(saved => mediaKey(saved) === key);

  if (index >= 0) {
    state.watchlist.splice(index, 1);
    toast('Removed from your watchlist.');
  } else {
    state.watchlist.unshift(savedMediaItem(item));
    state.watchlist = state.watchlist.slice(0, 80);
    toast('Added to your watchlist.');
  }

  saveCollections();
}

function pushHistory(item) {
  const key = mediaKey(item);
  state.history = state.history.filter(saved => mediaKey(saved) !== key);
  state.history.unshift(savedMediaItem(item, true));
  state.history = state.history.slice(0, 30);
  saveCollections();
}

function restorePlayerProgress(item) {
  const saved = state.history.find(entry => mediaKey(entry) === mediaKey(item));
  const sameEpisode = mediaTypeOf(item) !== 'tv'
    || (toInteger(saved?.season, -1) === state.currentSeason && toInteger(saved?.episode, -1) === state.currentEpisode);
  state.playerProgress = sameEpisode
    ? {
        watched: Math.max(0, Number(saved?.watched) || 0),
        duration: Math.max(0, Number(saved?.duration) || 0)
      }
    : { watched: 0, duration: 0 };
  state.lastProgressSavedAt = 0;
}

function updatePlayerProgress(item, watched, duration, forceSave = false) {
  const nextWatched = Number(watched);
  const nextDuration = Number(duration);
  if (Number.isFinite(nextWatched) && nextWatched >= 0) state.playerProgress.watched = nextWatched;
  if (Number.isFinite(nextDuration) && nextDuration > 0) state.playerProgress.duration = nextDuration;

  const now = Date.now();
  if (forceSave || now - state.lastProgressSavedAt >= 5000) {
    state.lastProgressSavedAt = now;
    pushHistory(item);
  }
}

const API = {
  async get(path, params = {}, ttl = CONFIG.CACHE_TTL) {
    const url = new URL(`${CONFIG.API_BASE}${path}`, window.location.origin);
    const mergedParams = { language: 'en-US', ...params };

    Object.entries(mergedParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    const cacheKey = url.toString();
    const cached = state.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (cached) state.cache.delete(cacheKey);

    const request = this.request(url).catch(error => {
      state.cache.delete(cacheKey);
      throw error;
    });

    state.cache.set(cacheKey, { promise: request, expiresAt: Date.now() + ttl });
    if (state.cache.size > CONFIG.CACHE_LIMIT) {
      state.cache.delete(state.cache.keys().next().value);
    }

    return request;
  },

  async request(url) {
    let lastError;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        let payload;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }

        if (!response.ok) {
          const error = new Error(payload?.error || `The catalog service returned ${response.status}.`);
          error.status = response.status;
          throw error;
        }
        if (!payload) throw new Error('The catalog service returned an invalid response.');
        return payload;
      } catch (error) {
        lastError = error;
        const status = Number(error?.status) || 0;
        const retryable = (!status || status >= 500) && !/not configured/i.test(error?.message || '');
        if (attempt === 0 && retryable) await sleep(450);
        else break;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (lastError?.name === 'AbortError') {
      throw new Error('The request took too long.');
    }
    throw lastError || new Error('Content could not be loaded.');
  },

  trending: () => API.get('/trending/all/week', { page: 1 }),
  anime: (page = 1) => API.discover('tv', page, {
    with_genres: '16',
    with_original_language: 'ja',
    'vote_count.gte': 25
  }),
  discover: (type, page = 1, filters = {}) => API.get(`/discover/${type}`, {
    sort_by: 'popularity.desc',
    include_adult: 'false',
    watch_region: CONFIG.REGION,
    page,
    ...filters
  }),
  details: (type, id) => API.get(`/${type}/${id}`, {
    append_to_response: 'videos,credits,similar,watch/providers'
  }),
  season: (id, season) => API.get(`/tv/${id}/season/${season}`),
  genres: type => API.get(`/genre/${type}/list`, {}, CONFIG.LONG_CACHE_TTL),
  search: (query, page = 1) => API.get('/search/multi', {
    query,
    include_adult: 'false',
    page
  })
};

function mediaCard(item, fallbackType, variant = 'poster') {
  const id = validId(item?.id);
  if (!id || item?.media_type === 'person') return '';

  const type = mediaTypeOf(item, fallbackType);
  const title = titleOf(item);
  const titleSafe = escapeHtml(title);
  const isLandscape = variant === 'landscape';
  const imagePath = isLandscape
    ? item.backdrop_path || item.poster_path || item.profile_path
    : item.poster_path || item.backdrop_path || item.profile_path;
  const poster = imgUrl(imagePath, isLandscape ? 'w780' : 'w342');
  const srcset = imageSrcset(
    imagePath,
    isLandscape
      ? [['w300', 300], ['w780', 780], ['w1280', 1280]]
      : [['w185', 185], ['w342', 342], ['w500', 500]]
  );
  const year = yearOf(item);
  const rating = Number(item.vote_average);
  const initial = escapeHtml(initialOf(title));
  const progress = type === 'tv' && toInteger(item?.episode, 0) > 0
    ? `${seasonLabel(toInteger(item.season, 1))} · Episode ${toInteger(item.episode, 1)}`
    : '';
  const anime = isAnime(item);

  return `
    <a class="card${isLandscape ? ' card-landscape' : ''}" href="${watchHref(item, type)}" aria-label="Open ${titleSafe}">
      <div class="card-poster" data-fallback="${initial}">
        ${poster
          ? `<img src="${poster}" srcset="${srcset}" sizes="${isLandscape ? '(max-width: 760px) 72vw, 340px' : '(max-width: 500px) 50vw, (max-width: 760px) 33vw, 220px'}" alt="${titleSafe} poster" loading="lazy" decoding="async" data-fallback-image>`
          : `<div class="poster-placeholder" aria-hidden="true">${initial}</div>`}
        ${Number.isFinite(rating) && rating > 0
          ? `<span class="rating" aria-label="Rated ${rating.toFixed(1)} out of 10">★ ${rating.toFixed(1)}</span>`
          : ''}
        <span class="media-badge">${anime ? 'Anime' : type === 'tv' ? 'Series' : 'Movie'}</span>
        ${progress ? `<span class="progress-badge">${escapeHtml(progress)}</span>` : ''}
      </div>
      <div class="card-copy">
        <h3 class="card-title">${titleSafe}</h3>
        <div class="card-meta">
          <span>${year || 'Date TBA'}</span>
          <span>${anime ? 'Anime' : type === 'tv' ? 'TV' : 'Film'}</span>
        </div>
      </div>
    </a>`;
}

function mediaCards(items, fallbackType, variant = 'poster') {
  return (Array.isArray(items) ? items : [])
    .map(item => mediaCard(item, fallbackType, variant))
    .filter(Boolean)
    .join('');
}

function mediaGrid(items, fallbackType) {
  return `<div class="media-grid">${mediaCards(items, fallbackType)}</div>`;
}

function mediaRail(items, fallbackType) {
  return `<div class="media-rail">${mediaCards(items, fallbackType, 'landscape')}</div>`;
}

function hero(item) {
  if (!item || !validId(item.id)) return '';

  const type = mediaTypeOf(item);
  const title = titleOf(item);
  const titleSafe = escapeHtml(title);
  const overview = escapeHtml(item.overview || 'Discover this title and start watching when you are ready.');
  const backdropPath = item.backdrop_path || item.poster_path;
  const mobilePath = item.poster_path || item.backdrop_path;
  const backdrop = imgUrl(backdropPath, 'w1280');
  const mobilePoster = imgUrl(mobilePath, 'w780');
  const year = yearOf(item);
  const rating = Number(item.vote_average);
  const saved = inWatchlist(item);

  return `
    <section class="hero" aria-labelledby="featured-title">
      ${backdrop
        ? `<picture class="hero-picture">
            ${mobilePoster ? `<source media="(max-width: 720px)" srcset="${imageSrcset(mobilePath, [['w342', 342], ['w500', 500], ['w780', 780]])}" sizes="100vw">` : ''}
            <img class="hero-media" src="${backdrop}" srcset="${imageSrcset(backdropPath, [['w780', 780], ['w1280', 1280], ['original', 1920]])}" sizes="100vw" alt="" fetchpriority="high" decoding="async">
          </picture>`
        : '<div class="hero-no-image" aria-hidden="true"></div>'}
      <div class="hero-shade" aria-hidden="true"></div>
      <div class="hero-content">
        <p class="eyebrow"><span>Streambox spotlight</span></p>
        <h1 id="featured-title">${titleSafe}</h1>
        <div class="hero-meta">
          ${Number.isFinite(rating) && rating > 0 ? `<span class="hero-rating">★ ${rating.toFixed(1)}</span>` : ''}
          ${year ? `<span>${year}</span>` : ''}
          <span>${type === 'tv' ? 'Series' : 'Movie'}</span>
        </div>
        <p class="hero-copy">${overview}</p>
        <div class="hero-actions">
          <a class="btn btn-accent" href="${watchHref(item, type)}">${icon('play')} Play</a>
          <button class="btn btn-quiet" id="heroWatchlistBtn" type="button">
            ${icon(saved ? 'bookmarkFilled' : 'bookmark')}
            <span>${saved ? 'In my list' : 'My list'}</span>
          </button>
        </div>
      </div>
    </section>`;
}

function sectionBlock(title, content, options = {}) {
  const note = options.note ? `<p class="section-note">${escapeHtml(options.note)}</p>` : '';
  const link = options.action === 'clear-history'
    ? `<button class="section-link section-button" type="button" data-clear-history>${icon('trash')} Clear history</button>`
    : options.href
    ? `<a class="section-link" href="${options.href}">${escapeHtml(options.linkText || 'View all')} →</a>`
    : '';

  return `
    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">${escapeHtml(title)}</h2>
          ${note}
        </div>
        ${link}
      </div>
      ${content}
    </section>`;
}

function actorCard(actor) {
  const name = actor?.name || 'Unknown cast member';
  const role = actor?.character || 'Cast';
  const photo = imgUrl(actor?.profile_path, 'w185');
  const nameSafe = escapeHtml(name);

  return `
    <article class="actor">
      ${photo
        ? `<img class="actor-photo" src="${photo}" srcset="${imageSrcset(actor?.profile_path, [['w45', 45], ['w185', 185], ['h632', 421]])}" sizes="54px" alt="${nameSafe}" loading="lazy" decoding="async">`
        : `<div class="actor-placeholder" aria-hidden="true">${escapeHtml(initialOf(name))}</div>`}
      <div>
        <h3 class="actor-name">${nameSafe}</h3>
        <p class="actor-role">${escapeHtml(role)}</p>
      </div>
    </article>`;
}

function availableSeasons(data) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (Array.isArray(data?.seasons) ? data.seasons : [])
    .filter(season => {
      if (!season || toInteger(season.episode_count) < 1) return false;
      if (!season.air_date) return true;
      const airDate = new Date(`${season.air_date}T00:00:00`);
      return Number.isNaN(airDate.getTime()) || airDate <= today;
    })
    .sort((first, second) => toInteger(first.season_number) - toInteger(second.season_number));
}

function seasonLabel(number) {
  return Number(number) === 0 ? 'Specials' : `Season ${number}`;
}

function availableEpisodes(seasonData) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (Array.isArray(seasonData?.episodes) ? seasonData.episodes : [])
    .filter(episode => {
      if (!episode || toInteger(episode.episode_number) < 1 || !episode.air_date) return false;
      const airDate = new Date(`${episode.air_date}T00:00:00`);
      return !Number.isNaN(airDate.getTime()) && airDate <= today;
    })
    .sort((first, second) => toInteger(first.episode_number) - toInteger(second.episode_number));
}

function currentSource(type) {
  const sources = PLAYER_SOURCES[type] || PLAYER_SOURCES.movie;
  return sources[clamp(state.currentServer, 0, Math.max(sources.length - 1, 0))];
}

function sourceIndex(type, value) {
  const sources = PLAYER_SOURCES[type] || PLAYER_SOURCES.movie;
  const byId = sources.findIndex(source => source.id === value);
  if (byId >= 0) return byId;
  return clamp(toInteger(value, 0), 0, Math.max(sources.length - 1, 0));
}

function configurePlayback(data, params, seasons) {
  const type = mediaTypeOf(data);
  const key = mediaKey(data);
  const isNewTitle = state.currentMediaKey !== key;
  const sources = PLAYER_SOURCES[type];

  if (isNewTitle) {
    state.currentMediaKey = key;
    state.currentServer = sourceIndex(type, state.sourcePreferences[type]);
    state.currentSeason = 1;
    state.currentEpisode = 1;
  }

  if (params.source !== undefined) {
    state.currentServer = sourceIndex(type, params.source);
  } else if (params.server !== undefined) {
    state.currentServer = sourceIndex(type, params.server);
  } else if (isNewTitle) {
    state.currentServer = clamp(state.currentServer, 0, Math.max(sources.length - 1, 0));
  }

  if (type === 'tv') {
    const defaultSeason = seasons.find(season => toInteger(season.season_number) === 1)
      || seasons.find(season => toInteger(season.season_number) > 0)
      || seasons[0];
    const requestedSeason = params.season !== undefined
      ? toInteger(params.season, defaultSeason?.season_number ?? 1)
      : state.currentSeason;
    const selectedSeason = seasons.find(season => toInteger(season.season_number) === requestedSeason)
      || defaultSeason;

    state.currentSeason = toInteger(selectedSeason?.season_number, 1);
    const episodeCount = Math.max(toInteger(selectedSeason?.episode_count, 1), 1);
    const requestedEpisode = params.episode !== undefined
      ? toInteger(params.episode, 1)
      : state.currentEpisode;
    state.currentEpisode = clamp(requestedEpisode, 1, episodeCount);
  }
}

function configureEpisodeSelection(episodes, requestedEpisode) {
  if (!episodes.length) {
    state.currentEpisode = 1;
    return;
  }
  const requested = toInteger(requestedEpisode, state.currentEpisode);
  const exact = episodes.find(episode => toInteger(episode.episode_number) === requested);
  state.currentEpisode = toInteger((exact || episodes[episodes.length - 1]).episode_number, 1);
}

function serverSelector(type) {
  const sources = PLAYER_SOURCES[type] || PLAYER_SOURCES.movie;
  return `
    <div class="select-group">
      <label for="serverSelect">Playback source</label>
      <select class="select" id="serverSelect">
        ${sources.map((source, index) => `
          <option value="${escapeHtml(source.id)}" ${index === state.currentServer ? 'selected' : ''}>${escapeHtml(source.name)}${source.badge ? ` · ${escapeHtml(source.badge)}` : ''}</option>
        `).join('')}
      </select>
    </div>`;
}

function episodeSelector(seasons, episodes) {
  const currentIndex = episodes.findIndex(episode => toInteger(episode.episode_number) === state.currentEpisode);

  return `
    <div class="episode-controls">
      <div class="select-group">
        <label for="seasonSelect">Season</label>
        <select class="select" id="seasonSelect">
          ${seasons.map(season => {
            const number = toInteger(season.season_number);
            return `<option value="${number}" ${number === state.currentSeason ? 'selected' : ''}>${seasonLabel(number)} · ${toInteger(season.episode_count)} episodes</option>`;
          }).join('')}
        </select>
      </div>
      <div class="select-group">
        <label for="episodeSelect">Episode</label>
        <select class="select" id="episodeSelect" ${episodes.length ? '' : 'disabled'}>
          ${episodes.length
            ? episodes.map(episode => {
                const number = toInteger(episode.episode_number);
                const name = episode.name && episode.name !== `Episode ${number}` ? ` · ${episode.name}` : '';
                return `<option value="${number}" ${number === state.currentEpisode ? 'selected' : ''}>Episode ${number}${escapeHtml(name)}</option>`;
              }).join('')
            : '<option>No aired episodes</option>'}
        </select>
      </div>
      <div class="select-group">
        <label>Skip episode</label>
        <div class="episode-nav">
          <button class="btn" id="previousEpisodeBtn" type="button" aria-label="Previous episode" title="Previous episode" ${currentIndex <= 0 ? 'disabled' : ''}>${icon('left')}</button>
          <button class="btn" id="nextEpisodeBtn" type="button" aria-label="Next episode" title="Next episode" ${currentIndex < 0 || currentIndex >= episodes.length - 1 ? 'disabled' : ''}>${icon('right')}</button>
        </div>
      </div>
    </div>`;
}

function providerQuery(data, source) {
  const type = mediaTypeOf(data);
  const params = new URLSearchParams();

  if (source.provider === 'vidlink') {
    params.set('primaryColor', 'c94d68');
    params.set('secondaryColor', '164e45');
    params.set('iconColor', 'fffaf0');
    params.set('icons', 'default');
    params.set('player', 'default');
    params.set('title', 'true');
    params.set('poster', 'true');
    params.set('autoplay', 'false');
    // Streambox owns episode navigation so the iframe cannot silently move
    // to an episode that disagrees with the URL and Continue Watching state.
    params.set('nextbutton', 'false');
    if (state.playerProgress.watched >= 5) {
      params.set('startAt', String(Math.floor(state.playerProgress.watched)));
    }
    params.set('fallback_url', new URL('/player-fallback.html', window.location.origin).toString());
  }

  if (source.provider === 'vidlove') {
    params.set('primarycolor', 'c94d68');
    params.set('secondarycolor', 'd6a94f');
    params.set('iconcolor', 'fffaf0');
    params.set('autoplay', 'false');
    params.set('poster', 'true');
    params.set('chromecast', 'true');
    params.set('pip', 'true');
    params.set('setting', 'true');
    params.set('servericon', 'false');
    if (type === 'tv') {
      params.set('autonext', 'false');
      params.set('nextbutton', 'false');
      params.set('episodes', 'false');
    }
  }

  return params;
}

function embedUrl(data) {
  const type = mediaTypeOf(data);
  const source = currentSource(type);
  const id = validId(data.id);
  let url = `${source.base}${id}`;
  if (type === 'tv') url += `/${state.currentSeason}/${state.currentEpisode}`;
  const params = providerQuery(data, source);
  const query = params.toString();
  return `${url}${query ? `?${query}` : ''}`;
}

function videoEmbed(data) {
  const title = escapeHtml(titleOf(data));
  const source = currentSource(mediaTypeOf(data));
  const session = state.playerSession;
  return `
    <div class="player-container">
      <iframe
        id="videoPlayer"
        data-src="${escapeHtml(embedUrl(data))}"
        data-session="${session}"
        data-source="${escapeHtml(source.id)}"
        title="${title} video player"
        allow="autoplay *; encrypted-media *; picture-in-picture *; fullscreen *"
        allowfullscreen="true"
        webkitallowfullscreen="true"
        mozallowfullscreen="true"
        frameborder="0"
        scrolling="no"
        loading="eager"
        referrerpolicy="origin-when-cross-origin"
      ></iframe>
      <div class="player-loading" id="playerLoading" role="status">
        <div class="loader-copy" id="playerStatusCopy"><span class="spinner" aria-hidden="true"></span><span>Loading ${escapeHtml(source.name)}…</span></div>
        <button class="btn btn-accent player-next-btn" id="playerNextSourceBtn" type="button" hidden>${icon('retry')} Try next source</button>
      </div>
    </div>`;
}

function playerShell(data) {
  return `
    <div class="player-shell" id="playerShell">
      <div class="player-frame" id="player">${videoEmbed(data)}</div>
    </div>`;
}

function regionalProviderData(data) {
  const result = data?.['watch/providers']?.results?.[CONFIG.REGION];
  return result && typeof result === 'object' ? result : {};
}

function whereToWatchHref(data) {
  const value = regionalProviderData(data).link;
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function detailsBlock(data) {
  const type = mediaTypeOf(data);
  const anime = isAnime(data);
  const providerData = regionalProviderData(data);
  const providers = Array.isArray(providerData.flatrate) ? providerData.flatrate : [];
  const providerLink = whereToWatchHref(data);
  const genres = Array.isArray(data.genres) ? data.genres : [];
  const year = yearOf(data);
  const runtime = type === 'movie'
    ? toInteger(data.runtime)
    : toInteger(Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : 0);
  const rating = Number(data.vote_average);

  return `
    <p class="detail-kicker">${anime ? 'Anime series' : type === 'tv' ? 'TV series' : 'Movie'}</p>
    <h1 class="detail-title">${escapeHtml(titleOf(data))}</h1>
    <div class="meta-row">
      ${year ? `<span class="meta-pill">${year}</span>` : ''}
      ${runtime ? `<span class="meta-pill">${runtime} min</span>` : ''}
      ${type === 'tv' && toInteger(data.number_of_seasons)
        ? `<span class="meta-pill">${toInteger(data.number_of_seasons)} season${toInteger(data.number_of_seasons) === 1 ? '' : 's'}</span>`
        : ''}
      ${Number.isFinite(rating) && rating > 0 ? `<span class="meta-pill rating-pill">★ ${rating.toFixed(1)}</span>` : ''}
    </div>
    ${genres.length
      ? `<div class="chips">${genres.map(genre => `<span class="chip">${escapeHtml(genre.name)}</span>`).join('')}</div>`
      : ''}
    <p class="detail-copy">${escapeHtml(data.overview || 'No overview is available yet.')}</p>
    ${providers.length
      ? `<div class="provider-block">
          <h2 class="provider-title">Available on</h2>
          <div class="chips">
            ${providers.slice(0, 8).map(provider => {
              const logo = imgUrl(provider.logo_path, 'w45');
              return `<span class="chip">${logo ? `<img src="${logo}" alt="">` : ''}${escapeHtml(provider.provider_name)}</span>`;
            }).join('')}
          </div>
          <p class="provider-credit">Philippines availability data from JustWatch via TMDB.${providerLink ? ` <a href="${escapeHtml(providerLink)}" target="_blank" rel="noopener noreferrer nofollow">View provider details</a>.` : ''}</p>
        </div>`
      : ''}`;
}

function seasonCards(seasons) {
  return `
    <div class="seasons-grid">
      ${seasons.map(season => {
        const number = toInteger(season.season_number);
        const active = number === state.currentSeason;
        const overview = season.overview
          ? `<p class="season-overview">${escapeHtml(season.overview)}</p>`
          : '';
        return `
          <button class="season-card ${active ? 'active' : ''}" type="button" data-season="${number}" aria-pressed="${active}">
            <h3 class="season-name">${seasonLabel(number)}</h3>
            <div class="episode-count">${toInteger(season.episode_count)} episode${toInteger(season.episode_count) === 1 ? '' : 's'}</div>
            ${overview}
          </button>`;
      }).join('')}
    </div>`;
}

function episodeCards(episodes) {
  if (!episodes.length) {
    return '<p class="episode-empty">No aired episodes are listed for this season yet.</p>';
  }

  return `
    <div class="episodes-grid">
      ${episodes.map(episode => {
        const number = toInteger(episode.episode_number);
        const title = episode.name || `Episode ${number}`;
        const still = imgUrl(episode.still_path, 'w300');
        const active = number === state.currentEpisode;
        return `
          <button class="episode-card ${active ? 'active' : ''}" type="button" data-episode="${number}" aria-pressed="${active}">
            <span class="episode-still">
              ${still
                ? `<img src="${still}" srcset="${imageSrcset(episode.still_path, [['w185', 185], ['w300', 300], ['w500', 500]])}" sizes="(max-width: 500px) 42vw, 260px" alt="" loading="lazy" decoding="async">`
                : `<span class="episode-placeholder" aria-hidden="true">E${number}</span>`}
              <span class="episode-number">Episode ${number}</span>
            </span>
            <span class="episode-card-copy">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(episode.air_date || '')}</span>
            </span>
          </button>`;
      }).join('')}
    </div>`;
}

function loadingView(includeHero = false) {
  return `
    ${includeHero ? '<div class="skeleton skeleton-hero" aria-hidden="true"></div>' : ''}
    <div class="skeleton-grid" aria-hidden="true">
      ${Array.from({ length: 12 }, () => '<div class="skeleton skeleton-card"></div>').join('')}
    </div>`;
}

function errorView(error) {
  const message = error?.message || 'Content could not be loaded.';
  return `
    <section class="error-state">
      <div class="state-inner">
        <div class="state-icon" aria-hidden="true">!</div>
        <h1 class="state-title">This screen did not load</h1>
        <p class="state-copy">${escapeHtml(message)}</p>
        <button class="btn btn-accent" type="button" data-retry>${icon('retry')} Try again</button>
      </div>
    </section>`;
}

function emptyView(title, message, actionHref = '#/home', actionLabel = 'Browse titles') {
  return `
    <section class="empty-state">
      <div class="state-inner">
        <div class="state-icon" aria-hidden="true">S</div>
        <h1 class="state-title">${escapeHtml(title)}</h1>
        <p class="state-copy">${escapeHtml(message)}</p>
        <a class="btn btn-accent" href="${actionHref}">${escapeHtml(actionLabel)}</a>
      </div>
    </section>`;
}

function normalizedYear(value) {
  const year = toInteger(value, 0);
  const maxYear = new Date().getFullYear() + 2;
  return year >= 1870 && year <= maxYear ? year : '';
}

function normalizedRating(value) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating >= 0 && rating <= 10 ? rating : 0;
}

function sortOptions(type, selected, searchMode = false) {
  const options = searchMode
    ? [
        ['relevance', 'Best match'],
        ['popularity', 'Most popular'],
        ['rating', 'Highest rated'],
        ['newest', 'Newest first'],
        ['oldest', 'Oldest first'],
        ['title', 'Title A–Z']
      ]
    : [
        ['popularity', 'Most popular'],
        ['rating', 'Highest rated'],
        ['newest', type === 'movie' ? 'Newest releases' : 'Newest premieres'],
        ['oldest', 'Oldest first'],
        ['title', 'Title A–Z']
      ];

  return options.map(([value, label]) => (
    `<option value="${value}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function filterBar({ route, params, type = 'movie', genres = [], searchMode = false }) {
  const selectedType = searchMode && ['movie', 'tv'].includes(params.type) ? params.type : (searchMode ? 'all' : type);
  const selectedGenre = validId(params.genre);
  const selectedYear = normalizedYear(params.year);
  const selectedRating = normalizedRating(params.rating);
  const selectedSort = typeof params.sort === 'string' ? params.sort : (searchMode ? 'relevance' : 'popularity');
  const query = searchMode ? String(params.q || '').slice(0, 100) : '';
  const clearParams = searchMode && query ? { q: query } : {};

  return `
    <form class="filter-bar" data-filter-form data-route="${escapeHtml(route)}">
      ${searchMode
        ? `<label class="filter-field filter-query">
            <span>Search</span>
            <input class="filter-input" type="search" name="q" value="${escapeHtml(query)}" placeholder="Movie or TV title" maxlength="100" required>
          </label>
          <label class="filter-field">
            <span>Type</span>
            <select class="select" name="type" data-filter-type>
              <option value="all" ${selectedType === 'all' ? 'selected' : ''}>Movies &amp; TV</option>
              <option value="movie" ${selectedType === 'movie' ? 'selected' : ''}>Movies</option>
              <option value="tv" ${selectedType === 'tv' ? 'selected' : ''}>TV series</option>
            </select>
          </label>`
        : ''}
      <label class="filter-field">
        <span>Genre</span>
        <select class="select" name="genre" ${searchMode && selectedType === 'all' ? 'disabled' : ''}>
          <option value="">All genres</option>
          ${genres.map(genre => `<option value="${validId(genre.id)}" ${String(genre.id) === selectedGenre ? 'selected' : ''}>${escapeHtml(genre.name)}</option>`).join('')}
        </select>
      </label>
      <label class="filter-field filter-year">
        <span>Year</span>
        <input class="filter-input" type="number" name="year" min="1870" max="${new Date().getFullYear() + 2}" inputmode="numeric" placeholder="Any" value="${selectedYear}">
      </label>
      <label class="filter-field">
        <span>Rating</span>
        <select class="select" name="rating">
          <option value="" ${selectedRating === 0 ? 'selected' : ''}>Any rating</option>
          ${[5, 6, 7, 8, 9].map(rating => `<option value="${rating}" ${selectedRating === rating ? 'selected' : ''}>${rating}+ / 10</option>`).join('')}
        </select>
      </label>
      <label class="filter-field">
        <span>Sort</span>
        <select class="select" name="sort">${sortOptions(selectedType === 'all' ? 'movie' : selectedType, selectedSort, searchMode)}</select>
      </label>
      <div class="filter-actions">
        <button class="btn btn-accent" type="submit">${icon('search')} Apply</button>
        <a class="btn btn-quiet" href="${hashHref(route, clearParams)}">Clear</a>
      </div>
    </form>`;
}

function watchlistFilterBar(params) {
  const query = String(params.q || '').slice(0, 80);
  const type = ['movie', 'tv'].includes(params.type) ? params.type : 'all';
  const sort = ['recent', 'title', 'rating', 'year'].includes(params.sort) ? params.sort : 'recent';
  return `
    <form class="filter-bar watchlist-filters" data-filter-form data-route="/watchlist">
      <label class="filter-field filter-query">
        <span>Find saved title</span>
        <input class="filter-input" type="search" name="q" value="${escapeHtml(query)}" placeholder="Search your watchlist">
      </label>
      <label class="filter-field">
        <span>Type</span>
        <select class="select" name="type">
          <option value="all" ${type === 'all' ? 'selected' : ''}>Movies &amp; TV</option>
          <option value="movie" ${type === 'movie' ? 'selected' : ''}>Movies</option>
          <option value="tv" ${type === 'tv' ? 'selected' : ''}>TV series</option>
        </select>
      </label>
      <label class="filter-field">
        <span>Sort</span>
        <select class="select" name="sort">
          <option value="recent" ${sort === 'recent' ? 'selected' : ''}>Recently added</option>
          <option value="title" ${sort === 'title' ? 'selected' : ''}>Title A–Z</option>
          <option value="rating" ${sort === 'rating' ? 'selected' : ''}>Highest rated</option>
          <option value="year" ${sort === 'year' ? 'selected' : ''}>Newest release</option>
        </select>
      </label>
      <div class="filter-actions">
        <button class="btn btn-accent" type="submit">Apply</button>
        <a class="btn btn-quiet" href="#/watchlist">Clear</a>
      </div>
    </form>`;
}

function paginationMarkup(path, params, currentPage, totalPages, label = 'Catalog') {
  return `
    <nav class="pagination" aria-label="${escapeHtml(label)} pages">
      ${currentPage > 1
        ? `<a class="btn" href="${hashHref(path, { ...params, page: currentPage - 1 })}">${icon('left')} Previous</a>`
        : '<span></span>'}
      <span class="page-info">${currentPage} / ${totalPages}</span>
      ${currentPage < totalPages
        ? `<a class="btn" href="${hashHref(path, { ...params, page: currentPage + 1 })}">Next ${icon('right')}</a>`
        : '<span></span>'}
    </nav>`;
}

function discoverParams(type, params) {
  const sortMap = {
    popularity: 'popularity.desc',
    rating: 'vote_average.desc',
    newest: type === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
    oldest: type === 'movie' ? 'primary_release_date.asc' : 'first_air_date.asc',
    title: type === 'movie' ? 'title.asc' : 'name.asc'
  };
  const filters = {
    sort_by: sortMap[params.sort] || sortMap.popularity,
    with_genres: validId(params.genre),
    'vote_average.gte': normalizedRating(params.rating) || '',
    'vote_count.gte': normalizedRating(params.rating) ? 50 : (params.sort === 'rating' ? 200 : '')
  };
  const year = normalizedYear(params.year);
  if (year) filters[type === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
  return filters;
}

function sortSearchResults(items, sort) {
  const results = [...items];
  const dateValue = item => Date.parse(item.release_date || item.first_air_date || '') || 0;
  if (sort === 'popularity') results.sort((a, b) => Number(b.popularity) - Number(a.popularity));
  if (sort === 'rating') results.sort((a, b) => Number(b.vote_average) - Number(a.vote_average));
  if (sort === 'newest') results.sort((a, b) => dateValue(b) - dateValue(a));
  if (sort === 'oldest') results.sort((a, b) => dateValue(a) - dateValue(b));
  if (sort === 'title') results.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  return results;
}

async function renderHome(token) {
  const app = el('#app');
  if (!app) return;
  setDocumentTitle();
  app.innerHTML = loadingView(true);

  try {
    const [trending, movies, shows, anime] = await Promise.all([
      API.trending(),
      API.discover('movie', 1),
      API.discover('tv', 1),
      API.anime(1)
    ]);
    if (!isCurrentRender(token)) return;

    const trendingItems = Array.isArray(trending.results) ? trending.results.filter(item => item.media_type !== 'person') : [];
    const movieItems = Array.isArray(movies.results) ? movies.results : [];
    const showItems = Array.isArray(shows.results) ? shows.results : [];
    const animeItems = Array.isArray(anime.results) ? anime.results : [];
    const featured = trendingItems.find(item => item.backdrop_path)
      || movieItems.find(item => item.backdrop_path)
      || showItems.find(item => item.backdrop_path)
      || trendingItems[0]
      || movieItems[0]
      || showItems[0];

    const blocks = [
      featured ? hero(featured) : '',
      state.history.length
        ? sectionBlock('Continue watching', mediaRail(state.history.slice(0, 12)), {
            note: 'Your latest season and episode are saved on this device.',
            action: 'clear-history'
          })
        : '',
      trendingItems.length
        ? sectionBlock('Trending this week', mediaRail(trendingItems.slice(0, 18)), {
            note: 'Movies and series people are watching now.'
          })
        : '',
      movieItems.length
        ? sectionBlock('Popular movies', mediaRail(movieItems.slice(0, 18), 'movie'), {
            href: '#/movies',
            linkText: 'All movies'
          })
        : '',
      showItems.length
        ? sectionBlock('Popular TV series', mediaRail(showItems.slice(0, 18), 'tv'), {
            href: '#/tv',
            linkText: 'All series'
          })
        : '',
      animeItems.length
        ? sectionBlock('Anime worlds', mediaRail(animeItems.slice(0, 18), 'tv'), {
            note: 'Popular Japanese animation from the TMDB catalog.',
            href: '#/anime',
            linkText: 'Explore anime'
          })
        : ''
    ].filter(Boolean);

    app.innerHTML = blocks.length
      ? blocks.join('')
      : emptyView('Nothing to show yet', 'The catalog returned no titles. Try again in a moment.');

    if (featured) bindHeroActions(featured);
  } catch (error) {
    if (!isCurrentRender(token)) return;
    console.error('Home view failed.', error);
    app.innerHTML = errorView(error);
  }
}

async function renderAnime(params, token) {
  const app = el('#app');
  if (!app) return;
  const currentPage = clamp(toInteger(params.page, 1), 1, 500);
  setDocumentTitle('Anime');
  app.innerHTML = loadingView(false);

  try {
    const data = await API.anime(currentPage);
    if (!isCurrentRender(token)) return;
    const items = Array.isArray(data.results) ? data.results : [];
    const totalPages = clamp(toInteger(data.total_pages, 1), 1, 500);
    const totalResults = Math.max(toInteger(data.total_results, items.length), items.length);
    app.innerHTML = `
      <header class="page-head anime-page-head">
        <div>
          <p class="eyebrow">Animated worlds</p>
          <h1 class="page-title">Anime</h1>
          <p class="page-subtitle">Popular Japanese animated series, organized from the TMDB catalog.</p>
        </div>
        <span class="result-count">${totalResults.toLocaleString()} titles</span>
      </header>
      ${items.length
        ? mediaGrid(items, 'tv')
        : emptyView('No anime found', 'The anime catalog returned no titles. Try again in a moment.')}
      ${items.length ? paginationMarkup('/anime', params, currentPage, totalPages, 'Anime') : ''}`;
  } catch (error) {
    if (!isCurrentRender(token)) return;
    console.error('Anime view failed.', error);
    app.innerHTML = errorView(error);
  }
}

function bindHeroActions(item) {
  const button = el('#heroWatchlistBtn');
  if (!button) return;

  const refresh = () => {
    const saved = inWatchlist(item);
    button.innerHTML = `${icon(saved ? 'bookmarkFilled' : 'bookmark')}<span>${saved ? 'In my list' : 'My list'}</span>`;
    button.setAttribute('aria-pressed', String(saved));
  };

  refresh();
  button.addEventListener('click', () => {
    toggleWatchlist(item);
    refresh();
  });
}

async function renderDiscover(type, params, token) {
  const app = el('#app');
  if (!app) return;

  const currentPage = clamp(toInteger(params.page, 1), 1, 500);
  const isMovie = type === 'movie';
  const label = isMovie ? 'Movies' : 'TV series';
  setDocumentTitle(label);
  app.innerHTML = loadingView(false);

  try {
    const [data, genreData] = await Promise.all([
      API.discover(type, currentPage, discoverParams(type, params)),
      API.genres(type)
    ]);
    if (!isCurrentRender(token)) return;

    const items = Array.isArray(data.results) ? data.results : [];
    const genres = Array.isArray(genreData.genres) ? genreData.genres : [];
    const totalPages = clamp(toInteger(data.total_pages, 1), 1, 500);
    const totalResults = Math.max(toInteger(data.total_results, items.length), items.length);
    const route = isMovie ? '/movies' : '/tv';

    app.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Browse catalog</p>
          <h1 class="page-title">${label}</h1>
          <p class="page-subtitle">Popular picks from the TMDB catalog.</p>
        </div>
        <span class="result-count">${totalResults.toLocaleString()} titles</span>
      </header>
      ${filterBar({ route, params, type, genres })}
      ${items.length
        ? mediaGrid(items, type)
        : emptyView(`No ${label.toLowerCase()} found`, 'Change or clear the filters and try again.', hashHref(route), 'Clear filters')}
      ${items.length ? paginationMarkup(route, params, currentPage, totalPages, label) : ''}`;
  } catch (error) {
    if (!isCurrentRender(token)) return;
    console.error(`${label} view failed.`, error);
    app.innerHTML = errorView(error);
  }
}

async function renderSearch(params, token) {
  const app = el('#app');
  if (!app) return;

  const query = String(params.q || '').trim().slice(0, 100);
  const currentPage = clamp(toInteger(params.page, 1), 1, 500);
  const selectedType = ['movie', 'tv'].includes(params.type) ? params.type : 'all';
  const input = el('#q');
  const clearButton = el('#searchClear');
  if (input) input.value = query;
  if (clearButton) clearButton.hidden = !query;
  setDocumentTitle(query ? `Search: ${query}` : 'Search');

  if (!query) {
    app.innerHTML = `
      <header class="page-head">
        <div><p class="eyebrow">Find your next watch</p><h1 class="page-title">Search</h1><p class="page-subtitle">Search movies and TV series, then narrow the results.</p></div>
      </header>
      ${filterBar({ route: '/search', params, type: 'movie', genres: [], searchMode: true })}`;
    return;
  }

  app.innerHTML = loadingView(false);
  try {
    const genreRequest = selectedType === 'all' ? Promise.resolve({ genres: [] }) : API.genres(selectedType);
    const [data, genreData] = await Promise.all([API.search(query, currentPage), genreRequest]);
    if (!isCurrentRender(token)) return;

    const genreId = validId(params.genre);
    const year = normalizedYear(params.year);
    const rating = normalizedRating(params.rating);
    const baseResults = (Array.isArray(data.results) ? data.results : [])
      .filter(item => ['movie', 'tv'].includes(item.media_type) && validId(item.id));
    const filtered = baseResults.filter(item => {
      if (selectedType !== 'all' && item.media_type !== selectedType) return false;
      if (genreId && !(Array.isArray(item.genre_ids) && item.genre_ids.some(id => String(id) === genreId))) return false;
      if (year && Number(yearOf(item)) !== year) return false;
      if (rating && Number(item.vote_average) < rating) return false;
      return true;
    });
    const items = sortSearchResults(filtered, params.sort || 'relevance');
    const genres = Array.isArray(genreData.genres) ? genreData.genres : [];
    const totalPages = clamp(toInteger(data.total_pages, 1), 1, 500);
    const totalResults = Math.max(toInteger(data.total_results, baseResults.length), baseResults.length);

    app.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">Search results</p>
          <h1 class="page-title">${escapeHtml(query)}</h1>
          <p class="page-subtitle">${items.length} matching title${items.length === 1 ? '' : 's'} on this page · ${totalResults.toLocaleString()} results before filters.</p>
        </div>
      </header>
      ${filterBar({ route: '/search', params: { ...params, q: query }, type: selectedType === 'all' ? 'movie' : selectedType, genres, searchMode: true })}
      ${items.length
        ? mediaGrid(items)
        : emptyView('No titles match these filters', 'Try a different type, year, rating, or genre.', hashHref('/search', { q: query }), 'Clear filters')}
      ${paginationMarkup('/search', { ...params, q: query }, currentPage, totalPages, 'Search result')}`;
  } catch (error) {
    if (!isCurrentRender(token)) return;
    console.error('Search view failed.', error);
    app.innerHTML = errorView(error);
  }
}

function renderWatchlist(params = {}) {
  const app = el('#app');
  if (!app) return;
  setDocumentTitle('Watchlist');

  if (!state.watchlist.length) {
    app.innerHTML = emptyView(
      'Your watchlist is empty',
      'Save a movie or TV series and it will appear here on this device.'
    );
    return;
  }

  const query = String(params.q || '').trim().toLocaleLowerCase();
  const type = ['movie', 'tv'].includes(params.type) ? params.type : 'all';
  const sort = ['recent', 'title', 'rating', 'year'].includes(params.sort) ? params.sort : 'recent';
  const filtered = state.watchlist.filter(item => {
    if (type !== 'all' && mediaTypeOf(item) !== type) return false;
    return !query || titleOf(item).toLocaleLowerCase().includes(query);
  });
  const items = [...filtered];
  if (sort === 'title') items.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  if (sort === 'rating') items.sort((a, b) => Number(b.vote_average) - Number(a.vote_average));
  if (sort === 'year') items.sort((a, b) => Number(yearOf(b)) - Number(yearOf(a)));
  if (sort === 'recent') items.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  app.innerHTML = `
    <header class="page-head">
      <div>
        <p class="eyebrow">Saved on this device</p>
        <h1 class="page-title">Watchlist</h1>
        <p class="page-subtitle">Your shortlist, ready when you are.</p>
      </div>
      <span class="result-count">${items.length} of ${state.watchlist.length} saved</span>
    </header>
    ${watchlistFilterBar(params)}
    ${items.length
      ? mediaGrid(items)
      : emptyView('No saved titles match', 'Change or clear your watchlist filters.', '#/watchlist', 'Clear filters')}`;
}

async function renderWatch(params, token) {
  const app = el('#app');
  if (!app) return;

  const type = params.type === 'tv' ? 'tv' : 'movie';
  const id = validId(params.id);
  if (!id) {
    app.innerHTML = emptyView('Title not found', 'The playback link is incomplete or invalid.');
    return;
  }

  app.innerHTML = loadingView(false);

  try {
    const data = await API.details(type, id);
    if (!isCurrentRender(token)) return;

    data.media_type = type;
    const seasons = type === 'tv' ? availableSeasons(data) : [];
    configurePlayback(data, params, seasons);
    let episodes = [];
    if (type === 'tv' && seasons.length) {
      const seasonData = await API.season(id, state.currentSeason);
      if (!isCurrentRender(token)) return;
      episodes = availableEpisodes(seasonData);
      configureEpisodeSelection(episodes, params.episode);
    }
    restorePlayerProgress(data);
    pushHistory(data);
    state.activePlayerData = data;
    setDocumentTitle(titleOf(data));
    const whereToWatch = whereToWatchHref(data);

    const controls = `
      <div class="control-grid">
        ${serverSelector(type)}
        ${type === 'tv' && seasons.length ? episodeSelector(seasons, episodes) : ''}
      </div>
      <div class="watch-actions">
        <button class="btn" id="watchlistBtn" type="button">
          ${icon(inWatchlist(data) ? 'bookmarkFilled' : 'bookmark')}
          <span>${inWatchlist(data) ? 'In watchlist' : 'Add to watchlist'}</span>
        </button>
        <button class="btn" id="nextSourceBtn" type="button">
          ${icon('retry')} Try next source
        </button>
        ${whereToWatch
          ? `<a class="btn" id="whereToWatchBtn" href="${escapeHtml(whereToWatch)}" target="_blank" rel="noopener noreferrer nofollow">
              ${icon('external')} Where to watch
            </a>`
          : ''}
      </div>
      <p class="source-help">Using <strong>${escapeHtml(currentSource(type).name)}</strong>. Streambox keeps episode changes in sync; use Try next source if this player is unavailable.</p>`;

    const cast = Array.isArray(data.credits?.cast) ? data.credits.cast.slice(0, 14) : [];
    const similar = Array.isArray(data.similar?.results) ? data.similar.results.slice(0, 18) : [];

    app.innerHTML = [
      `<div class="watch-layout">
        <section class="panel player-panel" aria-label="Playback">
          ${playerShell(data)}
          <div class="watch-controls">${controls}</div>
        </section>
        <aside class="panel detail-panel">${detailsBlock(data)}</aside>
      </div>`,
      type === 'tv' && seasons.length
        ? sectionBlock('Seasons', seasonCards(seasons), { note: 'Choose a season to update the player and episode list.' })
        : '',
      type === 'tv' && seasons.length
        ? sectionBlock(`${seasonLabel(state.currentSeason)} episodes`, episodeCards(episodes), {
            note: `${episodes.length} aired episode${episodes.length === 1 ? '' : 's'} available. Future and undated episodes are hidden.`
          })
        : '',
      cast.length
        ? sectionBlock('Cast', `<div class="cast-grid">${cast.map(actorCard).join('')}</div>`)
        : '',
      similar.length
        ? sectionBlock('More like this', mediaRail(similar, type))
        : ''
    ].filter(Boolean).join('');

    syncWatchUrl(data);
    bindPlayerControls(data, seasons, episodes);

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  } catch (error) {
    if (!isCurrentRender(token)) return;
    console.error('Playback view failed.', error);
    app.innerHTML = errorView(error);
  }
}

function refreshEpisodeControls(episodes) {
  const seasonSelect = el('#seasonSelect');
  if (seasonSelect) seasonSelect.value = String(state.currentSeason);

  const episodeSelect = el('#episodeSelect');
  if (episodeSelect && episodes.length) episodeSelect.value = String(state.currentEpisode);

  const currentIndex = episodes.findIndex(episode => toInteger(episode.episode_number) === state.currentEpisode);
  const previousButton = el('#previousEpisodeBtn');
  const nextButton = el('#nextEpisodeBtn');
  if (previousButton) previousButton.disabled = currentIndex <= 0;
  if (nextButton) nextButton.disabled = currentIndex < 0 || currentIndex >= episodes.length - 1;

  els('[data-season]').forEach(button => {
    const active = toInteger(button.dataset.season) === state.currentSeason;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  els('[data-episode]').forEach(button => {
    const active = toInteger(button.dataset.episode) === state.currentEpisode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncWatchUrl(data) {
  const params = new URLSearchParams({
    type: mediaTypeOf(data),
    id: validId(data.id),
    source: currentSource(mediaTypeOf(data)).id
  });

  if (mediaTypeOf(data) === 'tv') {
    params.set('season', String(state.currentSeason));
    params.set('episode', String(state.currentEpisode));
  }

  const nextHash = `#/watch?${params.toString()}`;
  if (location.hash !== nextHash) {
    history.replaceState(null, '', `${location.pathname}${location.search}${nextHash}`);
  }
}

function disposePlayerFrame() {
  window.clearTimeout(state.playerLoadTimer);
  const iframe = el('#videoPlayer');
  if (iframe) {
    iframe.removeAttribute('src');
    iframe.remove();
  }
  state.playerSession += 1;
  state.activePlayerData = null;
}

function isActivePlayer(iframe, source, session) {
  return Boolean(
    iframe?.isConnected
    && Number(iframe.dataset.session) === session
    && iframe.dataset.source === source.id
    && iframe === el('#videoPlayer')
  );
}

function markPlayerReady(data, source, iframe, session) {
  if (!isActivePlayer(iframe, source, session)) return;
  const loading = el('#playerLoading');
  if (loading) {
    loading.classList.add('hidden');
    loading.setAttribute('aria-hidden', 'true');
  }
  window.clearTimeout(state.playerLoadTimer);
  saveSourcePreference(mediaTypeOf(data), source.id);
  pushHistory(data);
}

function markPlayerFailed(data, source, iframe, session, message) {
  if (!isActivePlayer(iframe, source, session)) return;
  const loading = el('#playerLoading');
  const statusCopy = el('#playerStatusCopy');
  const nextButton = el('#playerNextSourceBtn');
  if (!loading) return;
  loading.classList.remove('hidden');
  loading.classList.add('failed');
  loading.setAttribute('aria-hidden', 'false');
  if (statusCopy) statusCopy.textContent = message || `${source.name} could not start this title.`;
  if (nextButton) nextButton.hidden = false;
}

function normalizePlayerMessage(value, data) {
  let message = value;
  if (typeof message === 'string') {
    try { message = JSON.parse(message); } catch { return null; }
  }
  if (!message || typeof message !== 'object') return null;

  if (message.type === 'MEDIA_DATA') {
    const media = message.data?.[validId(data.id)] || message.data;
    const episodeKey = `s${state.currentSeason}e${state.currentEpisode}`;
    const progress = media?.show_progress?.[episodeKey]?.progress || media?.progress;
    return progress ? {
      event: 'timeupdate',
      currentTime: progress.watched,
      duration: progress.duration
    } : null;
  }

  const payload = message.type === 'PLAYER_EVENT' && message.data && typeof message.data === 'object'
    ? message.data
    : message.data && typeof message.data === 'object' && !message.event
      ? { ...message.data, event: message.data.event || message.type }
      : message;
  const eventName = String(payload.event || payload.type || '').toLowerCase();
  if (!['play', 'pause', 'seeked', 'ended', 'timeupdate'].includes(eventName)) return null;
  return {
    event: eventName,
    currentTime: payload.currentTime ?? payload.current_time ?? payload.time ?? payload.progress?.watched,
    duration: payload.duration ?? payload.progress?.duration
  };
}

function sendPlayerTime(iframe, source, seconds) {
  if (!iframe?.contentWindow || !source.externalSeek) return false;
  iframe.contentWindow.postMessage({ type: 'SET_TIME', time: seconds, currentTime: seconds }, source.origin);
  return true;
}

function handlePlayerMessage(event) {
  const iframe = el('#videoPlayer');
  const data = state.activePlayerData;
  if (!iframe || !data || event.source !== iframe.contentWindow) return;

  const source = currentSource(mediaTypeOf(data));
  const session = Number(iframe.dataset.session);
  if (!isActivePlayer(iframe, source, session)) return;

  if (event.origin === window.location.origin && event.data?.type === 'STREAMBOX_PLAYER_ERROR') {
    markPlayerFailed(data, source, iframe, session, `${source.name} reported that this title is unavailable.`);
    return;
  }
  if (event.origin !== source.origin) return;

  const playerEvent = normalizePlayerMessage(event.data, data);
  if (!playerEvent) return;
  markPlayerReady(data, source, iframe, session);

  const forceSave = playerEvent.event === 'pause' || playerEvent.event === 'seeked' || playerEvent.event === 'ended';
  updatePlayerProgress(data, playerEvent.currentTime, playerEvent.duration, forceSave);
  if (source.externalSeek && iframe.dataset.resumeSent !== 'true' && state.playerProgress.watched >= 5) {
    iframe.dataset.resumeSent = 'true';
    sendPlayerTime(iframe, source, Math.floor(state.playerProgress.watched));
  }
  if (playerEvent.event === 'ended') toast(mediaTypeOf(data) === 'tv' ? 'Episode finished. Choose the next episode when ready.' : 'Playback finished.');
}

function attachPlayerLoadHandlers(data) {
  const iframe = el('#videoPlayer');
  const loading = el('#playerLoading');
  const nextButton = el('#playerNextSourceBtn');
  if (!iframe || !loading) return;

  const source = currentSource(mediaTypeOf(data));
  const session = Number(iframe.dataset.session);

  window.clearTimeout(state.playerLoadTimer);

  iframe.addEventListener('load', () => {
    if (!isActivePlayer(iframe, source, session)) return;
    loading.classList.add('hidden');
    loading.setAttribute('aria-hidden', 'true');
    if (!source.events) markPlayerReady(data, source, iframe, session);
    if (source.externalSeek && state.playerProgress.watched >= 5) {
      window.setTimeout(() => {
        if (!isActivePlayer(iframe, source, session) || iframe.dataset.resumeSent === 'true') return;
        iframe.dataset.resumeSent = 'true';
        sendPlayerTime(iframe, source, Math.floor(state.playerProgress.watched));
      }, 900);
    }
  }, { once: true });
  iframe.addEventListener('error', () => {
    markPlayerFailed(data, source, iframe, session, `${source.name} could not load. Try another source.`);
  }, { once: true });
  if (nextButton) nextButton.addEventListener('click', () => tryNextSource(data));
  state.playerLoadTimer = window.setTimeout(() => {
    if (!isActivePlayer(iframe, source, session) || loading.classList.contains('hidden')) return;
    markPlayerFailed(data, source, iframe, session, `${source.name} is taking too long. The player remains available behind this message.`);
  }, 12000);

  const sourceUrl = iframe.dataset.src;
  if (sourceUrl) iframe.src = sourceUrl;
}

function renderPlayerFrame(data) {
  const player = el('#player');
  if (!player) return;
  disposePlayerFrame();
  state.activePlayerData = data;
  player.innerHTML = videoEmbed(data);
  attachPlayerLoadHandlers(data);
}

function chooseSource(data, index, announce = true) {
  const type = mediaTypeOf(data);
  const sources = PLAYER_SOURCES[type];
  state.currentServer = clamp(index, 0, sources.length - 1);
  renderPlayerFrame(data);
  syncWatchUrl(data);
  pushHistory(data);

  const select = el('#serverSelect');
  if (select) select.value = currentSource(type).id;
  const help = el('.source-help');
  if (help) help.innerHTML = `Using <strong>${escapeHtml(currentSource(type).name)}</strong>. Streambox keeps episode changes in sync; use Try next source if this player is unavailable.`;
  if (announce) toast(`Trying ${currentSource(type).name}.`);
}

function tryNextSource(data) {
  const sources = PLAYER_SOURCES[mediaTypeOf(data)];
  chooseSource(data, (state.currentServer + 1) % sources.length);
}

function updateWatchlistButton(data) {
  const button = el('#watchlistBtn');
  if (!button) return;
  const saved = inWatchlist(data);
  button.innerHTML = `${icon(saved ? 'bookmarkFilled' : 'bookmark')}<span>${saved ? 'In watchlist' : 'Add to watchlist'}</span>`;
}

function bindPlayerControls(data, seasons, episodes) {
  const serverSelect = el('#serverSelect');
  if (serverSelect) {
    serverSelect.addEventListener('change', event => {
      chooseSource(data, sourceIndex(mediaTypeOf(data), event.target.value));
    });
  }

  const nextSourceButton = el('#nextSourceBtn');
  if (nextSourceButton) nextSourceButton.addEventListener('click', () => tryNextSource(data));

  const changeSeason = seasonNumber => {
    const exists = seasons.some(season => toInteger(season.season_number) === seasonNumber);
    if (!exists) return;
    location.hash = hashHref('/watch', {
      type: mediaTypeOf(data),
      id: validId(data.id),
      source: currentSource(mediaTypeOf(data)).id,
      season: seasonNumber,
      episode: 1
    });
  };

  const seasonSelect = el('#seasonSelect');
  if (seasonSelect) {
    seasonSelect.addEventListener('change', event => changeSeason(toInteger(event.target.value)));
  }

  els('[data-season]').forEach(button => {
    button.addEventListener('click', () => changeSeason(toInteger(button.dataset.season)));
  });

  const changeEpisode = episodeNumber => {
    const selected = episodes.find(episode => toInteger(episode.episode_number) === episodeNumber);
    if (!selected) return;
    state.currentEpisode = toInteger(selected.episode_number, 1);
    state.playerProgress = { watched: 0, duration: 0 };
    refreshEpisodeControls(episodes);
    renderPlayerFrame(data);
    syncWatchUrl(data);
    pushHistory(data);
  };

  const episodeSelect = el('#episodeSelect');
  if (episodeSelect) {
    episodeSelect.addEventListener('change', event => changeEpisode(toInteger(event.target.value, 1)));
  }

  const previousButton = el('#previousEpisodeBtn');
  const nextButton = el('#nextEpisodeBtn');
  const adjacentEpisode = direction => {
    const index = episodes.findIndex(episode => toInteger(episode.episode_number) === state.currentEpisode);
    const target = episodes[index + direction];
    if (target) changeEpisode(toInteger(target.episode_number));
  };
  if (previousButton) previousButton.addEventListener('click', () => adjacentEpisode(-1));
  if (nextButton) nextButton.addEventListener('click', () => adjacentEpisode(1));

  els('[data-episode]').forEach(button => {
    button.addEventListener('click', () => changeEpisode(toInteger(button.dataset.episode)));
  });

  const watchlistButton = el('#watchlistBtn');
  if (watchlistButton) {
    watchlistButton.addEventListener('click', () => {
      toggleWatchlist(data);
      updateWatchlistButton(data);
    });
  }

  refreshEpisodeControls(episodes);
  attachPlayerLoadHandlers(data);
}

let searchTimer = 0;
let searchSequence = 0;
let selectedSuggestion = -1;

function setSuggestionsOpen(open) {
  const input = el('#q');
  const suggestions = el('#suggest');
  if (!input || !suggestions) return;
  suggestions.classList.toggle('show', Boolean(open));
  input.setAttribute('aria-expanded', String(Boolean(open)));
  if (!open) {
    selectedSuggestion = -1;
    input.removeAttribute('aria-activedescendant');
  }
}

function hideSuggestions() {
  setSuggestionsOpen(false);
}

function searchResultMarkup(item, index) {
  const id = validId(item.id);
  if (!id || item.media_type === 'person') return '';

  const type = mediaTypeOf(item);
  const title = titleOf(item);
  const poster = imgUrl(item.poster_path, 'w92');
  return `
    <a class="suggest-item" id="suggest-option-${index}" role="option" aria-selected="false" href="${watchHref(item, type)}">
      ${poster
        ? `<img class="suggest-poster" src="${poster}" srcset="${imageSrcset(item.poster_path, [['w45', 45], ['w92', 92], ['w185', 185]])}" sizes="42px" alt="" loading="lazy" decoding="async">`
        : `<span class="suggest-placeholder" aria-hidden="true">${escapeHtml(initialOf(title))}</span>`}
      <span class="suggest-copy">
        <span class="suggest-title">${escapeHtml(title)}</span>
        <span class="suggest-meta">${yearOf(item) || 'Date TBA'}</span>
      </span>
      <span class="suggest-kind">${type === 'tv' ? 'TV' : 'Film'}</span>
    </a>`;
}

async function runSearch(query, sequence) {
  const suggestions = el('#suggest');
  if (!suggestions) return;

  suggestions.innerHTML = '<div class="suggest-empty">Searching…</div>';
  setSuggestionsOpen(true);

  try {
    const data = await API.search(query);
    if (sequence !== searchSequence) return;

    const results = (Array.isArray(data.results) ? data.results : [])
      .filter(item => item.media_type !== 'person' && validId(item.id))
      .slice(0, 7);

    suggestions.innerHTML = results.length
      ? `${results.map(searchResultMarkup).join('')}<a class="suggest-all" href="${hashHref('/search', { q: query })}">${icon('search')} View all results for “${escapeHtml(query)}”</a>`
      : '<div class="suggest-empty">No matching titles found.</div>';
    setSuggestionsOpen(true);
  } catch (error) {
    if (sequence !== searchSequence) return;
    console.error('Search failed.', error);
    suggestions.innerHTML = '<div class="suggest-empty">Search is unavailable right now.</div>';
    setSuggestionsOpen(true);
  }
}

function selectSuggestion(index) {
  const options = els('.suggest-item', el('#suggest'));
  if (!options.length) return;

  selectedSuggestion = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    option.setAttribute('aria-selected', String(optionIndex === selectedSuggestion));
  });
  el('#q')?.setAttribute('aria-activedescendant', options[selectedSuggestion].id);
  options[selectedSuggestion].scrollIntoView({ block: 'nearest' });
}

function clearSearch(keepFocus = true) {
  const input = el('#q');
  const clearButton = el('#searchClear');
  if (!input) return;
  window.clearTimeout(searchTimer);
  searchSequence += 1;
  input.value = '';
  if (clearButton) clearButton.hidden = true;
  hideSuggestions();
  if (parseHash().path === '/search') location.hash = '#/search';
  if (keepFocus) input.focus();
}

function setupSearch() {
  const input = el('#q');
  const clearButton = el('#searchClear');
  const suggestions = el('#suggest');
  if (!input || !clearButton || !suggestions) return;

  input.addEventListener('input', event => {
    const query = event.target.value.trim();
    clearButton.hidden = !query;
    window.clearTimeout(searchTimer);
    searchSequence += 1;
    selectedSuggestion = -1;
    const sequence = searchSequence;

    if (!query) {
      hideSuggestions();
      suggestions.innerHTML = '';
      return;
    }

    searchTimer = window.setTimeout(() => runSearch(query, sequence), 280);
  });

  input.addEventListener('keydown', event => {
    const options = els('.suggest-item', suggestions);
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      selectSuggestion(selectedSuggestion + 1);
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      selectSuggestion(selectedSuggestion - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedSuggestion >= 0 && options[selectedSuggestion]) {
        options[selectedSuggestion].click();
      } else {
        const query = input.value.trim();
        if (query) location.hash = hashHref('/search', { q: query });
      }
    } else if (event.key === 'Escape') {
      hideSuggestions();
      input.blur();
    }
  });

  clearButton.addEventListener('click', () => clearSearch(true));
  suggestions.addEventListener('click', event => {
    if (event.target.closest('.suggest-item, .suggest-all')) hideSuggestions();
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.search-wrap')) hideSuggestions();
  });
}

function setMenuOpen(open) {
  const menu = el('#mobileMenu');
  const button = el('#mobileMenuBtn');
  if (!menu || !button) return;

  state.menuOpen = Boolean(open);
  menu.classList.toggle('active', state.menuOpen);
  menu.setAttribute('aria-hidden', String(!state.menuOpen));
  button.classList.toggle('active', state.menuOpen);
  button.setAttribute('aria-expanded', String(state.menuOpen));
  button.setAttribute('aria-label', state.menuOpen ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('menu-open', state.menuOpen);
}

function setupNavigationControls() {
  const menuButton = el('#mobileMenuBtn');
  const mobileMenu = el('#mobileMenu');

  if (menuButton) {
    menuButton.addEventListener('click', () => setMenuOpen(!state.menuOpen));
  }

  if (mobileMenu) {
    mobileMenu.addEventListener('click', event => {
      if (event.target === mobileMenu || event.target.closest('.mobile-menu-item')) {
        setMenuOpen(false);
      }
    });
  }

}

function parseHash() {
  const raw = (location.hash || '#/home').slice(1);
  const questionIndex = raw.indexOf('?');
  const path = questionIndex >= 0 ? raw.slice(0, questionIndex) : raw;
  const query = questionIndex >= 0 ? raw.slice(questionIndex + 1) : '';
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    params: Object.fromEntries(new URLSearchParams(query))
  };
}

function updateActiveTabs(path, params) {
  let activePath = path;
  if (path === '/watch') activePath = params.type === 'tv' ? '/tv' : '/movies';

  els('[data-tab]').forEach(tab => {
    const tabPath = tab.getAttribute('href')?.slice(1).split('?')[0];
    const active = tabPath === activePath;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

async function tick() {
  const token = ++state.renderToken;
  const app = el('#app');
  if (!app) return;

  const { path, params } = parseHash();
  disposePlayerFrame();
  setMenuOpen(false);
  hideSuggestions();
  updateActiveTabs(path, params);
  setAppBusy(true);

  if (path !== '/watch') window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    switch (path) {
      case '/home':
        await renderHome(token);
        break;
      case '/movies':
        await renderDiscover('movie', params, token);
        break;
      case '/tv':
        await renderDiscover('tv', params, token);
        break;
      case '/anime':
        await renderAnime(params, token);
        break;
      case '/watchlist':
        renderWatchlist(params);
        break;
      case '/search':
        await renderSearch(params, token);
        break;
      case '/watch':
        await renderWatch(params, token);
        break;
      default:
        history.replaceState(null, '', `${location.pathname}${location.search}#/home`);
        updateActiveTabs('/home', {});
        await renderHome(token);
    }
  } catch (error) {
    if (isCurrentRender(token)) {
      console.error('Route rendering failed.', error);
      app.innerHTML = errorView(error);
    }
  } finally {
    if (isCurrentRender(token)) setAppBusy(false);
  }
}

function setupGlobalEvents() {
  window.addEventListener('hashchange', tick);
  window.addEventListener('message', handlePlayerMessage);

  document.addEventListener('click', event => {
    if (event.target.closest('[data-retry]')) tick();
    const clearHistory = event.target.closest('[data-clear-history]');
    if (clearHistory && window.confirm('Clear your entire Continue Watching history on this device?')) {
      state.history = [];
      saveCollections();
      toast('Viewing history cleared.');
      tick();
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-filter-form]');
    if (!form) return;
    event.preventDefault();
    const values = {};
    new FormData(form).forEach((value, key) => {
      const text = String(value).trim();
      if (text && text !== 'all') values[key] = text;
    });
    location.hash = hashHref(form.dataset.route || '/home', values);
  });

  document.addEventListener('change', event => {
    if (!event.target.matches('[data-filter-type]')) return;
    const form = event.target.closest('[data-filter-form]');
    const genre = form?.querySelector('[name="genre"]');
    if (genre) {
      genre.disabled = event.target.value === 'all';
      if (genre.disabled) genre.value = '';
    }
    form?.requestSubmit();
  });

  document.addEventListener('error', event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;

    if (image.matches('[data-fallback-image]')) {
      const poster = image.closest('.card-poster');
      if (poster) poster.classList.add('image-failed');
      image.remove();
    } else if (image.classList.contains('hero-media')) {
      const picture = image.closest('.hero-picture');
      if (picture) picture.outerHTML = '<div class="hero-no-image" aria-hidden="true"></div>';
    }
  }, true);

  document.addEventListener('keydown', event => {
    const target = event.target;
    const isTyping = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target?.isContentEditable;

    if (event.key === '/' && !isTyping && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      el('#q')?.focus();
      return;
    }

    if (event.key === 'Escape') {
      if (state.menuOpen) {
        setMenuOpen(false);
      } else {
        hideSuggestions();
      }
    }
  });
}

function initializeApp() {
  loadLocalState();
  setupSearch();
  setupNavigationControls();
  setupGlobalEvents();
  tick();
}

document.addEventListener('DOMContentLoaded', initializeApp);
