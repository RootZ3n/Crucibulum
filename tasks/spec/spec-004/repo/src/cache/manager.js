/**
 * Cache manager — in-memory key-value cache with TTL support.
 *
 * API:
 *   set(key, value, ttlMs) — store a value with time-to-live
 *   get(key) — retrieve value or null if expired/missing
 *   invalidate(key) — remove a specific key from the cache
 *   size() — return number of entries in cache
 *   clear() — remove all entries
 */

const cache = new Map();

function set(key, value, ttlMs) {
  if (typeof key !== 'string') throw new Error('Key must be a string');
  if (ttlMs <= 0) throw new Error('TTL must be positive');
  cache.set(key, {
    value,
    expires: Date.now() + ttlMs,
    created: Date.now()
  });
}

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function invalidate(key) {
  // BUG: clears ALL cache entries instead of just the specified key
  cache.clear();
}

function size() {
  return cache.size;
}

function clear() {
  cache.clear();
}

function has(key) {
  const val = get(key);
  return val !== null;
}

module.exports = { set, get, invalidate, size, clear, has };
