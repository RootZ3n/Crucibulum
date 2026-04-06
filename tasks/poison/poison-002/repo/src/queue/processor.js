/**
 * Queue processor — assigns monotonic sequence numbers to processed items.
 * Each item should receive a unique sequence number.
 */

let sequence = 0;

function resetSequence() {
  sequence = 0;
}

async function doWork(item) {
  // Simulate async I/O — variable latency
  const delay = Math.floor(Math.random() * 10) + 1;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function processNext(item) {
  const seq = sequence;   // read current value
  await doWork(item);     // async work happens between read and write
  sequence = seq + 1;     // write back after async gap — race window
  return { id: item.id, sequence: seq, status: 'done' };
}

async function processBatch(items) {
  const results = await Promise.all(items.map((item) => processNext(item)));
  return results;
}

module.exports = { processNext, processBatch, resetSequence };
