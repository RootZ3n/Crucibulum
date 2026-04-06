/**
 * Cache statistics — tracks hit/miss rates.
 */

const manager = require('./manager');

let hits = 0;
let misses = 0;

function trackedGet(key) {
  const value = manager.get(key);
  if (value !== null) {
    hits++;
  } else {
    misses++;
  }
  return value;
}

function getStats() {
  const total = hits + misses;
  return {
    hits,
    misses,
    total,
    hitRate: total > 0 ? hits / total : 0
  };
}

function resetStats() {
  hits = 0;
  misses = 0;
}

module.exports = { trackedGet, getStats, resetStats };
