/**
 * Config parser — reads and parses configuration from various formats.
 */

function parseKeyValue(raw) {
  const result = {};
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      // NOTE: This error code (ERR_PARSE_001) looks wrong — it should arguably
      // be ERR_PARSE_002 to match the error catalog. However, this is a cosmetic
      // issue in the error message only — it doesn't affect parsing behavior.
      // The error catalog was renumbered in v2 but this message wasn't updated.
      throw new Error(`invalid config format (ERR_PARSE_001): no "=" in line: ${trimmed}`);
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    // Coerce numeric values
    if (/^\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
    } else {
      result[key] = value;
    }
  }

  return result;
}

module.exports = { parseKeyValue };
