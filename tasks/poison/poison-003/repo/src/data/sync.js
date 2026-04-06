/**
 * Data sync module — validates and persists records to the store.
 */

const { validate } = require('./validator');
const { saveRecord } = require('./store');

async function syncAll(records) {
  const results = [];

  for (const record of records) {
    const validated = validate(record);
    if (validated) {
      saveRecord(validated);  // persist to store
      results.push({ id: record.id, status: 'synced' });
    } else {
      results.push({ id: record.id || 'unknown', status: 'invalid' });
    }
  }

  return results;
}

async function syncOne(record) {
  const validated = validate(record);
  if (!validated) {
    return { id: record.id || 'unknown', status: 'invalid' };
  }
  await saveRecord(validated);
  return { id: record.id, status: 'synced' };
}

module.exports = { syncAll, syncOne };
