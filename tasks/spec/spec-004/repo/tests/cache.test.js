/**
 * Cache tests — public test suite
 * These tests are visible to the agent.
 */

const cache = require('../src/cache/manager');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.log(`  \u2717 ${message}`);
  }
}

// Reset between tests
function resetCache() {
  cache.clear();
}

console.log('Cache Tests:');

// Test 1: Set and get
resetCache();
cache.set('foo', 'bar', 60000);
assert(cache.get('foo') === 'bar', 'Should retrieve stored value');

// Test 2: Missing key returns null
resetCache();
assert(cache.get('nonexistent') === null, 'Missing key should return null');

// Test 3: Invalidate removes key
resetCache();
cache.set('temp', 'data', 60000);
cache.invalidate('temp');
assert(cache.get('temp') === null, 'Invalidated key should return null');

// Test 4: Size tracking
resetCache();
cache.set('a', 1, 60000);
cache.set('b', 2, 60000);
assert(cache.size() === 2, 'Size should be 2 after setting 2 keys');

// Test 5: Clear removes all
resetCache();
cache.set('x', 1, 60000);
cache.set('y', 2, 60000);
cache.clear();
assert(cache.size() === 0, 'Clear should remove all entries');

// Test 6: Invalid key type
let threw = false;
try { cache.set(42, 'val', 1000); } catch (e) { threw = true; }
assert(threw, 'Should throw for non-string key');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
