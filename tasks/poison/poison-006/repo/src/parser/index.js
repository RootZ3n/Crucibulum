/**
 * Parser module — combines validation and sanitization.
 */

const { validateEmail, validateUsername, validateAge } = require('./validator');
const { sanitizeHtml, sanitizeFilename, sanitizeSql } = require('./sanitizer');

function parseUserInput(fields) {
  const errors = [];
  const clean = {};

  if (fields.email) {
    if (!validateEmail(fields.email)) {
      errors.push('Invalid email address');
    }
    clean.email = fields.email.trim().toLowerCase();
  }

  if (fields.username) {
    if (!validateUsername(fields.username)) {
      errors.push('Invalid username');
    }
    clean.username = sanitizeHtml(fields.username);
  }

  if (fields.age !== undefined) {
    if (!validateAge(fields.age)) {
      errors.push('Invalid age');
    }
    clean.age = Number(fields.age);
  }

  if (fields.bio) {
    clean.bio = sanitizeHtml(fields.bio);
  }

  return { valid: errors.length === 0, errors, data: clean };
}

module.exports = { parseUserInput };
