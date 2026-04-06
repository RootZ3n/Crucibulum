/**
 * Input sanitizer — strips dangerous characters from user input.
 * NOTE: These regexes look complex but execute in linear time.
 */

function sanitizeHtml(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFilename(input) {
  if (typeof input !== 'string') return '';
  // Remove path traversal and special characters
  return input
    .replace(/\.\.\//g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255);
}

function sanitizeSql(input) {
  if (typeof input !== 'string') return '';
  // Basic SQL injection prevention (use parameterized queries in production)
  return input.replace(/['";\\]/g, '');
}

module.exports = { sanitizeHtml, sanitizeFilename, sanitizeSql };
