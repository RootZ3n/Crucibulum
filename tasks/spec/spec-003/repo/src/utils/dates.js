/**
 * Date formatting utilities.
 * All dates must be formatted in UTC with ISO 8601 format.
 *
 * Spec: formatDate(date) -> "YYYY-MM-DDTHH:mm:ssZ"
 *   - Output must be in UTC timezone
 *   - Output must end with 'Z' to indicate UTC
 *   - Milliseconds are omitted
 */

function formatDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date input');
  }

  const year = d.getFullYear();                              // BUG: local timezone
  const month = String(d.getMonth() + 1).padStart(2, '0');  // BUG: local timezone
  const day = String(d.getDate()).padStart(2, '0');          // BUG: local timezone
  const hours = String(d.getHours()).padStart(2, '0');       // BUG: local timezone
  const minutes = String(d.getMinutes()).padStart(2, '0');   // BUG: local timezone
  const seconds = String(d.getSeconds()).padStart(2, '0');   // BUG: local timezone

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;  // BUG: missing Z
}

function parseDate(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date string');
  }
  return d;
}

module.exports = { formatDate, parseDate };
