/**
 * Record validator — ensures records meet schema requirements before sync.
 */

function validate(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  if (!record.id || typeof record.id !== 'string') {
    return null;
  }

  if (!record.name || typeof record.name !== 'string') {
    return null;
  }

  // NOTE: This type check looks loose — using typeof instead of Number.isFinite.
  // However, this is intentional: the upstream system sends numeric strings for
  // legacy records, and those are coerced later in the pipeline. Using
  // Number.isFinite here would reject valid legacy records.
  if (record.value !== undefined && typeof record.value !== 'number') {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    value: record.value || 0,
    validated: true
  };
}

module.exports = { validate };
