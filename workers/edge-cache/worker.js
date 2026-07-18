/**
 * Fallback edge cache for static HTML on spritzconsulting.com.
 *
 * Only deploy this if a Cloudflare cache rule is not an option. A cache rule
 * does the same job with zero Worker invocations. See
 * docs/cloudflare-html-cache.md. Never run both at once.
 *
 * Behaviour: GET/HEAD requests for HTML paths are served from the Cloudflare
 * cache with a 2 hour edge TTL. Everything else passes straight through.
 */

const EDGE_TTL_SECONDS = 7200;

/** Paths the Worker must never touch (contact form Worker route). */
function isExcluded(pathname) {
  return pathname.startsWith('/api/');
}

/** Static HTML: explicit .html files plus directory index URLs. */
function isCacheableHtmlPath(pathname) {
  return pathname.endsWith('.html') || pathname.endsWith('/');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fetch(request);
    }
    if (isExcluded(url.pathname) || !isCacheableHtmlPath(url.pathname)) {
      return fetch(request);
    }

    // Drop the query string from the cache key so UTM params do not fragment
    // the cache. The site serves identical HTML regardless of query.
    const cacheKeyUrl = new URL(url.toString());
    cacheKeyUrl.search = '';
    const cacheKey = new Request(cacheKeyUrl.toString(), { method: 'GET' });

    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set('x-spritz-edge-cache', 'HIT');
      return hit;
    }

    const originResponse = await fetch(request);

    // Only store successful HTML. Redirects and errors stay uncached so a bad
    // deploy cannot pin a 404 at the edge for two hours.
    const contentType = originResponse.headers.get('content-type') || '';
    if (originResponse.status !== 200 || !contentType.includes('text/html')) {
      return originResponse;
    }

    const toCache = new Response(originResponse.body, originResponse);
    toCache.headers.set('cache-control', `public, max-age=${EDGE_TTL_SECONDS}`);
    toCache.headers.set('x-spritz-edge-cache', 'MISS');

    // Clone before returning: the body can only be consumed once.
    ctx.waitUntil(cache.put(cacheKey, toCache.clone()));
    return toCache;
  },
};
