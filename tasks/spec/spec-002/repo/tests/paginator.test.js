/**
 * Paginator tests — public test suite
 * These tests are visible to the agent.
 */

const { paginate, generateItems } = require('../src/data/paginator');

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

console.log('Paginator Tests:');

const items = generateItems(50);

// Test 1: First page should have items
const p1 = paginate(items, 1, 10);
assert(p1.items.length > 0, 'First page should return items');
assert(p1.page === 1, 'Page number should be 1');

// Test 2: Total should reflect full dataset
assert(p1.total === 50, 'Total should be 50');

// Test 3: Second page should have items
const p2 = paginate(items, 2, 10);
assert(p2.items.length > 0, 'Second page should return items');

// Test 4: hasMore should be true when more pages exist
assert(p1.hasMore === true, 'First page should have more');

// Test 5: Last page
const p5 = paginate(items, 5, 10);
assert(p5.items.length > 0, 'Last page should return items');

// Test 6: totalPages should be correct
assert(p1.totalPages === 5, 'Should have 5 total pages');

// Test 7: pageSize is preserved in output
assert(p1.pageSize === 10, 'pageSize should be preserved');

// Test 8: Items on different pages should not overlap
const firstId = p1.items[0].id;
const secondPageFirstId = p2.items[0].id;
assert(firstId !== secondPageFirstId, 'Different pages should have different first items');

// Test 9: Invalid input
try {
  paginate('not-array', 1, 10);
  assert(false, 'Should throw on non-array input');
} catch (e) {
  assert(true, 'Throws on non-array input');
}

// Test 10: generateItems helper
const gen = generateItems(5);
assert(gen.length === 5, 'generateItems should create correct count');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
