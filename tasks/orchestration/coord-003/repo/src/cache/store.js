/**
 * In-memory cache store with TTL support.
 * Each entry stores: { value, expiresAt }
 */
const cache = new Map();

function set(key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  // Check if expired
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function has(key) {
  const entry = cache.get(key);
  if (!entry) return false;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return false;
  }

  return true;
}

function del(key) {
  cache.delete(key);
}

function clear() {
  cache.clear();
}

function size() {
  return cache.size;
}

module.exports = { set, get, has, del, clear, size };
