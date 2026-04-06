const store = require('./store');

/**
 * Fetches data from a source and caches the result.
 * fetchFn should return a Response-like object with a .json() method,
 * simulating a network fetch.
 */
const DEFAULT_TTL = 60000; // 60 seconds

async function fetchAndCache(key, fetchFn, ttlMs = DEFAULT_TTL) {
  // Check cache first
  if (store.has(key)) {
    return store.get(key);
  }

  // Cache miss — fetch from source
  const response = await fetchFn();

  // Store the result in cache
  store.set(key, response, ttlMs);

  // Return parsed data for the caller
  const data = await response.json();
  return data;
}

async function invalidateAndRefetch(key, fetchFn, ttlMs = DEFAULT_TTL) {
  store.del(key);
  return fetchAndCache(key, fetchFn, ttlMs);
}

module.exports = { fetchAndCache, invalidateAndRefetch, DEFAULT_TTL };
