/**
 * In-memory store with async save/load to simulate database operations.
 */

const records = new Map();

async function saveRecord(record) {
  // Simulate async I/O latency (database write)
  await new Promise((resolve) => setTimeout(resolve, 5));
  records.set(record.id, { ...record, savedAt: Date.now() });
  return { id: record.id, saved: true };
}

function getRecord(id) {
  return records.get(id) || null;
}

function getAllRecords() {
  return Array.from(records.values());
}

function clearStore() {
  records.clear();
}

function getStoreSize() {
  return records.size;
}

module.exports = { saveRecord, getRecord, getAllRecords, clearStore, getStoreSize };
