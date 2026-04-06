/**
 * Search tests — public test suite
 * These tests are visible to the agent.
 */

const { search, searchWithLimit } = require('../src/search/engine');

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

console.log('Search Tests:');

// Small test dataset
const docs = [
  { id: '1', title: 'Alpha', content: 'the quick brown fox jumps over the lazy dog' },
  { id: '2', title: 'Beta', content: 'the lazy cat sleeps all day long' },
  { id: '3', title: 'Gamma', content: 'quick search results are important for users' },
  { id: '4', title: 'Delta', content: 'nothing relevant here at all' }
];

// Test 1: Basic search finds matching documents
const r1 = search('quick', docs);
assert(r1.length === 2, 'Should find 2 docs containing "quick"');
assert(r1[0].id === '1' || r1[0].id === '3', 'Should match doc 1 or 3');

// Test 2: Multi-term search
const r2 = search('the lazy', docs);
assert(r2.length >= 2, 'Multi-term search should find matching docs');
// Doc 1 has both "the" (2x) and "lazy" (1x) = 3 hits
// Doc 2 has "the" (1x) and "lazy" (1x) = 2 hits
assert(r2[0].id === '1', 'Doc 1 should rank highest for "the lazy"');

// Test 3: No results for unmatched query
const r3 = search('zzzzzzz', docs);
assert(r3.length === 0, 'Should return empty for no matches');

// Test 4: Empty query
const r4 = search('', docs);
assert(r4.length === 0, 'Empty query should return empty');

// Test 5: searchWithLimit respects limit
const r5 = searchWithLimit('the', docs, 1);
assert(r5.length === 1, 'searchWithLimit should respect limit');

// Test 6: Results sorted by score descending
const r6 = search('the lazy dog', docs);
for (let i = 1; i < r6.length; i++) {
  assert(r6[i - 1].score >= r6[i].score, `Result ${i - 1} score >= result ${i} score`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
