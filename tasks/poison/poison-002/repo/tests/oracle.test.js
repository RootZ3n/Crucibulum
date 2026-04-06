/**
 * Hidden oracle tests — verifies concurrent sequence uniqueness.
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

const { processBatch, resetSequence } = require('../src/queue/processor');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

async function runTests() {
  console.log('oracle.test.js — hidden tests\n');

  // Test 1: 10 concurrent items must all get unique sequence numbers
  resetSequence();
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}` }));
  const results = await processBatch(items);

  const sequences = results.map(r => r.sequence);
  const uniqueSequences = new Set(sequences);

  assert(results.length === 10, 'all 10 items processed');
  assert(uniqueSequences.size === 10, `all sequence numbers unique (got ${uniqueSequences.size} unique out of 10)`);

  // Test 2: Sequences should be 0-9 (no gaps)
  const sorted = [...sequences].sort((a, b) => a - b);
  const expected = Array.from({ length: 10 }, (_, i) => i);
  assert(
    JSON.stringify(sorted) === JSON.stringify(expected),
    `sequences are 0-9 with no gaps (got [${sorted.join(',')}])`
  );

  // Test 3: Run it again — 20 concurrent items
  resetSequence();
  const items2 = Array.from({ length: 20 }, (_, i) => ({ id: `big-${i}` }));
  const results2 = await processBatch(items2);
  const sequences2 = results2.map(r => r.sequence);
  const unique2 = new Set(sequences2);
  assert(unique2.size === 20, `20 concurrent items all unique (got ${unique2.size} unique)`);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
