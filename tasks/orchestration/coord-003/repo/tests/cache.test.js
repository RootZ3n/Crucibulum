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

// Helper: create a mock fetch function that returns a Response-like object
function mockFetch(data) {
  return async () => ({
    json: async () => data,
    ok: true,
    status: 200,
  });
}

async function run() {
  console.log('Cache tests (public)\n');

  // Test 1: Basic set/get
  store.clear();
  store.set('key1', { name: 'Alice' }, 5000);
  const val = store.get('key1');
  assert(val !== null, 'Cache set/get works');
  assert(val.name === 'Alice', 'Cached value is correct');

  // Test 2: Cache miss returns null
  const miss = store.get('nonexistent');
  assert(miss === null, 'Cache miss returns null');

  // Test 3: fetchAndCache returns data on first call
  store.clear();
  const data = await fetchAndCache('users', mockFetch({ users: [1, 2, 3] }), 5000);
  assert(data && data.users, 'fetchAndCache returns data on first call');
  assert(Array.isArray(data.users), 'Returned data has expected structure');

  // Test 4: Middleware serves data
  store.clear();
  const handler = createHandler('posts', mockFetch({ posts: ['a', 'b'] }), 5000);
  const result = await cacheMiddleware(handler);
  assert(result && result.posts, 'Middleware returns data');

  store.clear();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
