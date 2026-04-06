/**
 * Oracle tests — hidden test suite
 * Tests that invalidate() only removes the specified key, not all entries.
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

function resetCache() {
  cache.clear();
}

console.log('Oracle Tests (Cache Invalidation):');

// Test 1: Invalidate one key, others survive
resetCache();
cache.set('alpha', 'a', 60000);
cache.set('beta', 'b', 60000);
cache.set('gamma', 'c', 60000);
cache.invalidate('beta');
assert(cache.get('alpha') === 'a', 'alpha should survive after invalidating beta');
assert(cache.get('beta') === null, 'beta should be gone after invalidation');
assert(cache.get('gamma') === 'c', 'gamma should survive after invalidating beta');

// Test 2: Size reflects single removal
resetCache();
cache.set('one', 1, 60000);
cache.set('two', 2, 60000);
cache.set('three', 3, 60000);
cache.invalidate('two');
assert(cache.size() === 2, 'Size should be 2 after invalidating 1 of 3 keys');

// Test 3: Invalidate non-existent key should not affect others
resetCache();
cache.set('keep', 'me', 60000);
cache.invalidate('doesnotexist');
assert(cache.get('keep') === 'me', 'Invalidating non-existent key should not affect existing entries');
assert(cache.size() === 1, 'Size should still be 1');

// Test 4: Sequential invalidations
resetCache();
cache.set('a', 1, 60000);
cache.set('b', 2, 60000);
cache.set('c', 3, 60000);
cache.set('d', 4, 60000);
cache.invalidate('a');
cache.invalidate('c');
assert(cache.get('b') === 2, 'b should survive after invalidating a and c');
assert(cache.get('d') === 4, 'd should survive after invalidating a and c');
assert(cache.size() === 2, 'Size should be 2 after removing 2 of 4');

// Test 5: Set after invalidate should work
resetCache();
cache.set('reuse', 'old', 60000);
cache.invalidate('reuse');
cache.set('reuse', 'new', 60000);
assert(cache.get('reuse') === 'new', 'Should be able to set key again after invalidation');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
