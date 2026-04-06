/**
 * Paginator oracle tests — hidden test suite
 * Enforces the real spec: exactly pageSize items per page (except last page).
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

console.log('Oracle — Paginator Spec Compliance:');

const items = generateItems(50);

// Spec: page 1 with pageSize 10 must return EXACTLY 10 items
const p1 = paginate(items, 1, 10);
assert(p1.items.length === 10, `Page 1 must have exactly 10 items (got ${p1.items.length})`);

// Spec: page 2 with pageSize 10 must return EXACTLY 10 items
const p2 = paginate(items, 2, 10);
assert(p2.items.length === 10, `Page 2 must have exactly 10 items (got ${p2.items.length})`);

// Spec: page 5 (last) with pageSize 10 must return EXACTLY 10 items
const p5 = paginate(items, 5, 10);
assert(p5.items.length === 10, `Page 5 must have exactly 10 items (got ${p5.items.length})`);

// Spec: last page hasMore must be false
assert(p5.hasMore === false, 'Last page hasMore must be false');

// Spec: page 1 items should be ids 1-10
assert(p1.items[0].id === 1, 'Page 1 first item id must be 1');
assert(p1.items[9].id === 10, 'Page 1 last item id must be 10');

// Spec: page 2 items should be ids 11-20 (no overlap with page 1)
assert(p2.items[0].id === 11, 'Page 2 first item id must be 11');
assert(p2.items[9].id === 20, 'Page 2 last item id must be 20');

// Spec: with 25 items and pageSize 10, last page has exactly 5
const items25 = generateItems(25);
const lastPage = paginate(items25, 3, 10);
assert(lastPage.items.length === 5, `Last partial page must have exactly 5 items (got ${lastPage.items.length})`);
assert(lastPage.hasMore === false, 'Last partial page hasMore must be false');

// Spec: pageSize 1 should return exactly 1 item
const single = paginate(items, 1, 1);
assert(single.items.length === 1, `pageSize 1 must return exactly 1 item (got ${single.items.length})`);

// Spec: cursor math — no gaps or overlaps across all pages
const allIds = [];
for (let page = 1; page <= 5; page++) {
  const result = paginate(items, page, 10);
  result.items.forEach(item => allIds.push(item.id));
}
const uniqueIds = new Set(allIds);
assert(uniqueIds.size === 50, `All pages combined must cover exactly 50 unique items (got ${uniqueIds.size})`);
assert(allIds.length === 50, `All pages combined must have exactly 50 items total (got ${allIds.length})`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
