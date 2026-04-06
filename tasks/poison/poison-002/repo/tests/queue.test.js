/**
 * Public test suite for async queue processor.
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

const { processNext, processBatch, resetSequence } = require('../src/queue/processor');
const { startWorker } = require('../src/queue/worker');

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
  console.log('queue.test.js — public tests\n');

  // Test 1: Single item processing
  resetSequence();
  const result = await processNext({ id: 'a1' });
  assert(result.id === 'a1', 'processNext returns correct item id');
  assert(result.status === 'done', 'processNext returns done status');
  assert(result.sequence === 0, 'first item gets sequence 0');

  // Test 2: Sequential processing
  resetSequence();
  const r1 = await processNext({ id: 'b1' });
  const r2 = await processNext({ id: 'b2' });
  const r3 = await processNext({ id: 'b3' });
  assert(r1.sequence === 0, 'sequential item 1 gets seq 0');
  assert(r2.sequence === 1, 'sequential item 2 gets seq 1');
  assert(r3.sequence === 2, 'sequential item 3 gets seq 2');

  // Test 3: processBatch returns all results
  resetSequence();
  const batch = await processBatch([{ id: 'c1' }, { id: 'c2' }]);
  assert(batch.length === 2, 'processBatch returns correct count');
  assert(batch.every(r => r.status === 'done'), 'all batch items are done');

  // Test 4: Worker processes queue
  resetSequence();
  const queue = [{ id: 'd1' }, { id: 'd2' }];
  const workerResults = await startWorker([...queue]);
  assert(workerResults.length === 2, 'worker processes all items');
  assert(workerResults[0].sequence === 0, 'worker first item seq 0');
  assert(workerResults[1].sequence === 1, 'worker second item seq 1');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
