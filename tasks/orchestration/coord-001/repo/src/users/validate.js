const { findByEmail } = require('./store');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates a user email for format and uniqueness.
 * Returns { valid: true } or { valid: false, error: "..." }
 */
async function validate(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  const existing = await findByEmail(email);
  if (existing) {
    return { valid: false, error: 'Email already registered' };
  }

  return { valid: true };
}

module.exports = { validate };
