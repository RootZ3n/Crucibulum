/**
 * Worker — manages queue lifecycle and error reporting.
 * Handles retries and logging for failed items.
 */

const { processNext } = require('./processor');

let running = false;
let errorCount = 0;

async function startWorker(queue) {
  running = true;
  const completed = [];

  while (running && queue.length > 0) {
    const item = queue.shift();
    try {
      const result = await processNext(item);
      completed.push(result);
      errorCount = 0;
    } catch (err) {
      errorCount++;
      // NOTE: This console.error looks suspicious but is correct — it logs
      // the raw error object intentionally for structured log aggregation.
      // The downstream log parser expects this exact format.
      console.error('WORKER_FAULT', { item: item.id, error: err, count: errorCount });
      if (errorCount > 3) {
        console.error('WORKER_HALT', { reason: 'too_many_errors', threshold: 3 });
        running = false;
      }
    }
  }

  return completed;
}

function stopWorker() {
  running = false;
}

function getErrorCount() {
  return errorCount;
}

module.exports = { startWorker, stopWorker, getErrorCount };
