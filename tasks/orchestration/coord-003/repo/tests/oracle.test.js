const store = require('../src/cache/store');
const { fetchAndCache } = require('../src/cache/fetcher');
const { cacheMiddleware, createHandler } = require('../src/cache/middleware');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

function mockFetch(data) {
  return async () => ({
    json: async () => data,
    ok: true,
    status: 200,
  });
}

async function run() {
  console.log('Cache oracle tests (hidden)\n');

  // Test 1: Second call to fetchAndCache returns parsed data, not Response object
  store.clear();
  const fetchFn = mockFetch({ items: [1, 2, 3] });

  // First call — cache miss, fetches and caches
  const first = await fetchAndCache('test-key', fetchFn, 10000);
  assert(first && Array.isArray(first.items), 'First fetch returns parsed data');

  // Second call — cache hit, should return same parsed data
  const second = await fetchAndCache('test-key', fetchFn, 10000);
  assert(second && Array.isArray(second.items), 'Second fetch returns parsed data (not Response object)');
  assert(
    typeof second.json !== 'function',
    'Cached value is parsed data, not a Response object with .json() method'
  );

  // Test 2: TTL boundary — entry at exact expiry should be expired
  store.clear();
  const now = Date.now();
  // Set with 0ms TTL — should expire immediately
  store.set('expiring', { val: 'old' }, 0);

  // At exact boundary (Date.now() >= expiresAt), entry should be gone
  const expired = store.get('expiring');
  assert(expired === null, 'Entry at TTL boundary is expired (>= check)');

  // Test 3: has() also respects boundary
  store.clear();
  store.set('boundary', { val: 'test' }, 0);
  const hasBoundary = store.has('boundary');
  assert(hasBoundary === false, 'has() returns false at TTL boundary');

  // Test 4: Middleware returns parsed data on cache hit
  store.clear();
  let fetchCount = 0;
  const countingFetch = async () => {
    fetchCount++;
    return {
      json: async () => ({ count: fetchCount }),
      ok: true,
      status: 200,
    };
  };

  const handler = createHandler('counted', countingFetch, 10000);

  // First call
  const m1 = await cacheMiddleware(handler);
  assert(m1 && typeof m1.count === 'number', 'Middleware first call returns parsed data');

  // Second call — from cache, should still be parsed data
  const m2 = await cacheMiddleware(handler);
  assert(m2 && typeof m2.count === 'number', 'Middleware second call returns parsed data from cache');
  assert(typeof m2.json !== 'function', 'Middleware cached data is not a raw Response');

  // Test 5: After TTL expiry, re-fetch returns fresh parsed data
  store.clear();
  let fetchRound = 0;
  const roundFetch = async () => {
    fetchRound++;
    return {
      json: async () => ({ round: fetchRound }),
      ok: true,
      status: 200,
    };
  };

  // Set very short TTL
  const d1 = await fetchAndCache('short-ttl', roundFetch, 1);

  // Wait for expiry
  await new Promise((r) => setTimeout(r, 10));

  // Should re-fetch and return parsed data
  const d2 = await fetchAndCache('short-ttl', roundFetch, 1);
  assert(d2 && typeof d2.round === 'number', 'Re-fetch after TTL returns parsed data');
  assert(typeof d2.json !== 'function', 'Re-fetched data is parsed, not Response');

  store.clear();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
