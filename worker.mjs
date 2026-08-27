const TMDB_ORIGIN = 'https://api.themoviedb.org';
const API_PREFIX = '/api/tmdb';
const CACHE_CONTROL = 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400';

const ALLOWED_PATHS = [
  /^\/trending\/all\/(day|week)$/,
  /^\/discover\/(movie|tv)$/,
  /^\/(movie|tv)\/\d+$/,
  /^\/tv\/\d+\/season\/\d+$/,
  /^\/search\/multi$/,
  /^\/genre\/(movie|tv)\/list$/
];

const ALLOWED_QUERY_PARAMS = new Set([
  'append_to_response',
  'first_air_date_year',
  'include_adult',
  'language',
  'page',
  'primary_release_year',
  'query',
  'sort_by',
  'vote_average.gte',
  'vote_count.gte',
  'watch_region',
  'with_genres'
]);

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

function validateQuery(url) {
  for (const [key, value] of url.searchParams) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) return `Unsupported query parameter: ${key}`;
    if (value.length > 160) return `Query parameter is too long: ${key}`;
  }

  const page = url.searchParams.get('page');
  if (page && (!/^\d{1,3}$/.test(page) || Number(page) < 1 || Number(page) > 500)) {
    return 'Page must be between 1 and 500.';
  }

  const query = url.searchParams.get('query');
  if (query !== null && (!query.trim() || query.length > 100)) {
    return 'Search queries must contain between 1 and 100 characters.';
  }

  const append = url.searchParams.get('append_to_response');
  if (append && append !== 'videos,credits,similar,watch/providers') {
    return 'Unsupported appended response.';
  }

  return '';
}

function normalizeSecret(value) {
  let secret = String(value || '').trim();
  if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
    secret = secret.slice(1, -1).trim();
  }
  return secret;
}

function getTmdbCredentials(env) {
  const configuredToken = normalizeSecret(env.TMDB_TOKEN).replace(/^Bearer\s+/i, '').trim();
  const configuredApiKey = normalizeSecret(env.TMDB_API_KEY);

  // TMDB v3 keys are 32 hexadecimal characters. Accept one placed in
  // TMDB_TOKEN so an existing dashboard secret does not need to be renamed.
  if (/^[a-f0-9]{32}$/i.test(configuredToken)) {
    return { apiKey: configuredToken, token: '', mode: 'api_key' };
  }
  if (configuredToken) return { apiKey: '', token: configuredToken, mode: 'bearer' };
  if (configuredApiKey) return { apiKey: configuredApiKey, token: '', mode: 'api_key' };
  return { apiKey: '', token: '', mode: 'none' };
}

async function handleTmdb(request, env, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, { allow: 'GET, HEAD' });
  }

  const incomingUrl = new URL(request.url);
  const upstreamPath = incomingUrl.pathname.slice(API_PREFIX.length) || '/';
  if (!ALLOWED_PATHS.some(pattern => pattern.test(upstreamPath))) {
    return jsonResponse({ error: 'TMDB endpoint not found.' }, 404);
  }

  const validationError = validateQuery(incomingUrl);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  const credentials = getTmdbCredentials(env);
  if (credentials.mode === 'none') {
    return jsonResponse({ error: 'TMDB is not configured on this deployment.' }, 503);
  }

  const upstreamUrl = new URL(`/3${upstreamPath}`, TMDB_ORIGIN);
  for (const [key, value] of incomingUrl.searchParams) upstreamUrl.searchParams.append(key, value);
  if (!upstreamUrl.searchParams.has('language')) upstreamUrl.searchParams.set('language', 'en-US');
  if (credentials.apiKey) upstreamUrl.searchParams.set('api_key', credentials.apiKey);

  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.hash = '';
  const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    if (request.method === 'HEAD') {
      return new Response(null, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
    }
    return cached;
  }

  const headers = new Headers({ Accept: 'application/json' });
  if (credentials.token) headers.set('authorization', `Bearer ${credentials.token}`);

  const startedAt = Date.now();
  const upstream = await fetch(upstreamUrl, { headers });
  const responseHeaders = new Headers();
  responseHeaders.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('x-robots-tag', 'noindex, nofollow');
  responseHeaders.set('vary', 'accept-encoding');
  responseHeaders.set('cache-control', upstream.ok ? CACHE_CONTROL : 'no-store');

  const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });

  console.log(JSON.stringify({
    message: 'tmdb request',
    path: upstreamPath,
    status: upstream.status,
    duration_ms: Date.now() - startedAt,
    cache: 'miss'
  }));

  if (upstream.ok && request.method === 'GET') ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
        return await handleTmdb(request, env, ctx);
      }
      if (url.pathname === '/api/health') {
        const credentials = getTmdbCredentials(env);
        return jsonResponse({
          ok: true,
          tmdb_configured: credentials.mode !== 'none',
          tmdb_auth_mode: credentials.mode
        });
      }
      if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'API endpoint not found.' }, 404);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'request failed',
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error)
      }));
      return jsonResponse({ error: 'The service is temporarily unavailable.' }, 502);
    }
  }
};
