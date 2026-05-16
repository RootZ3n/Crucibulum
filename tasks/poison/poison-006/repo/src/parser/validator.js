/**
 * Input validator — validates user-provided fields.
 */

const EMAIL_REGEX = /^([a-zA-Z0-9.]+)*@[a-zA-Z0-9]+(\.[a-zA-Z]{2,})+$/;

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email);
}

function validateUsername(username) {
  if (typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 30) return false;
  return /^[a-zA-Z0-9_-]+$/.test(username);
}

function validateAge(age) {
  const n = Number(age);
  if (!Number.isInteger(n)) return false;
  return n >= 0 && n <= 150;
}

module.exports = { validateEmail, validateUsername, validateAge };
