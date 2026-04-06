/**
 * Oracle tests — hidden test suite
 * Tests that search completes within acceptable time for large datasets.
 * The O(n^2) bug makes this impossibly slow; the fix makes it fast.
 */

const { search } = require('../src/search/engine');
const { generateTestDocuments } = require('../src/search/index');

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

// Seed random for reproducible docs
let seed = 12345;
function seededRandom() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const origRandom = Math.random;
Math.random = seededRandom;

console.log('Oracle Tests (Search Performance):');

// Generate large dataset: 8000 docs with 200 words each
const largeDocs = generateTestDocuments(8000, 200);
Math.random = origRandom;

// Test 1: Large dataset search with many terms must complete within 500ms
// With the bug (re-splitting per term), this is very slow.
// With the fix (split once), this is fast.
const query1 = 'quick brown fox jumps over lazy dog alpha beta gamma delta epsilon zeta eta theta data system network cloud server client api cache search index query result';
const start1 = Date.now();
const r1 = search(query1, largeDocs);
const elapsed1 = Date.now() - start1;
assert(elapsed1 < 400, `Large search must complete in <400ms (took ${elapsed1}ms)`);
assert(r1.length > 0, 'Should find results in large dataset');

// Test 2: Results should still be correctly sorted
for (let i = 1; i < Math.min(r1.length, 20); i++) {
  assert(r1[i - 1].score >= r1[i].score, `Results must be sorted by score (pos ${i - 1} >= pos ${i})`);
}

// Test 3: Another large query
const query2 = 'user admin config deploy build test debug release memory disk cpu thread process queue stack heap';
const start2 = Date.now();
const r2 = search(query2, largeDocs);
const elapsed2 = Date.now() - start2;
assert(elapsed2 < 400, `Second large search must complete in <400ms (took ${elapsed2}ms)`);

// Test 4: Correctness check — small known dataset
const knownDocs = [
  { id: 'a', content: 'hello world hello' },
  { id: 'b', content: 'hello there' },
  { id: 'c', content: 'goodbye world' }
];
const r4 = search('hello world', knownDocs);
assert(r4.length === 3, 'Should find 3 matching docs');
assert(r4[0].id === 'a', 'Doc "a" should rank first (hello x2 + world x1 = 3)');
assert(r4[0].score === 3, 'Doc "a" should have score 3');

// Test 5: Single term on large dataset
const start5 = Date.now();
const r5 = search('alpha', largeDocs);
const elapsed5 = Date.now() - start5;
assert(elapsed5 < 300, `Single-term large search must complete in <300ms (took ${elapsed5}ms)`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
