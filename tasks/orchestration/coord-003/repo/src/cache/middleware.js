const store = require('./store');
const { fetchAndCache } = require('./fetcher');

/**
 * Cache middleware — serves data from cache if available,
 * otherwise fetches and caches it.
 *
 * handler: object with { key, fetchFn, ttlMs }
 * Returns the data (parsed).
 */
async function cacheMiddleware({ key, fetchFn, ttlMs }) {
  // Try serving from cache
  const cached = store.get(key);
  if (cached !== null) {
    return cached;
  }

  // Fetch, cache, and return
  const data = await fetchAndCache(key, fetchFn, ttlMs);
  return data;
}

/**
 * Creates a handler config for the middleware.
 */
function createHandler(key, fetchFn, ttlMs = 60000) {
  return { key, fetchFn, ttlMs };
}

module.exports = { cacheMiddleware, createHandler };
