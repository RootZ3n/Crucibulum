/**
 * Public test suite for data sync module.
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

const { validate } = require('../src/data/validator');
const { syncAll, syncOne } = require('../src/data/sync');
const { clearStore } = require('../src/data/store');

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
  console.log('sync.test.js — public tests\n');

  // Test 1: Validator accepts valid records
  const valid = validate({ id: 'r1', name: 'Test Record', value: 42 });
  assert(valid !== null, 'validate accepts valid record');
  assert(valid.validated === true, 'validate sets validated flag');

  // Test 2: Validator rejects missing fields
  assert(validate(null) === null, 'validate rejects null');
  assert(validate({ name: 'no id' }) === null, 'validate rejects missing id');
  assert(validate({ id: 'x' }) === null, 'validate rejects missing name');

  // Test 3: Validator handles optional value
  const noVal = validate({ id: 'r2', name: 'No Value' });
  assert(noVal !== null, 'validate accepts record without value');
  assert(noVal.value === 0, 'default value is 0');

  // Test 4: syncAll returns correct statuses
  clearStore();
  const records = [
    { id: 'a1', name: 'Alpha', value: 10 },
    { id: 'a2', name: 'Beta', value: 20 },
    { badrecord: true }
  ];
  const results = await syncAll(records);
  assert(results.length === 3, 'syncAll returns result for each input');
  assert(results[0].status === 'synced', 'valid record reports synced');
  assert(results[1].status === 'synced', 'second valid record reports synced');
  assert(results[2].status === 'invalid', 'invalid record reports invalid');

  // Test 5: syncOne works for valid record
  clearStore();
  const oneResult = await syncOne({ id: 's1', name: 'Single', value: 5 });
  assert(oneResult.status === 'synced', 'syncOne reports synced');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
