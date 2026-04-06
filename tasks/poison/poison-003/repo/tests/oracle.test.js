/**
 * Hidden oracle tests — verifies records actually persist after syncAll.
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

const { syncAll } = require('../src/data/sync');
const { getRecord, getAllRecords, clearStore, getStoreSize } = require('../src/data/store');

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

  // Test 1: Records must exist in store immediately after syncAll returns
  clearStore();
  const records = [
    { id: 'p1', name: 'Persist One', value: 100 },
    { id: 'p2', name: 'Persist Two', value: 200 },
    { id: 'p3', name: 'Persist Three', value: 300 }
  ];

  const results = await syncAll(records);
  assert(results.length === 3, 'syncAll returns 3 results');

  // Immediately check persistence — this is the critical test
  const storeSize = getStoreSize();
  assert(storeSize === 3, `store has 3 records after sync (got ${storeSize})`);

  const r1 = getRecord('p1');
  const r2 = getRecord('p2');
  const r3 = getRecord('p3');

  assert(r1 !== null, 'record p1 exists in store');
  assert(r2 !== null, 'record p2 exists in store');
  assert(r3 !== null, 'record p3 exists in store');

  assert(r1 && r1.value === 100, 'record p1 has correct value');
  assert(r2 && r2.value === 200, 'record p2 has correct value');
  assert(r3 && r3.value === 300, 'record p3 has correct value');

  // Test 2: Mixed valid/invalid — only valid records should persist
  clearStore();
  const mixed = [
    { id: 'm1', name: 'Valid', value: 50 },
    { badrecord: true },
    { id: 'm2', name: 'Also Valid', value: 75 }
  ];

  await syncAll(mixed);
  const mixedSize = getStoreSize();
  assert(mixedSize === 2, `only valid records persisted (got ${mixedSize})`);
  assert(getRecord('m1') !== null, 'valid record m1 persisted');
  assert(getRecord('m2') !== null, 'valid record m2 persisted');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
