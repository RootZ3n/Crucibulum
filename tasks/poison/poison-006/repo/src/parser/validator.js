/**
 * Input validator — validates user-provided fields.
 */

// BUG: This regex has catastrophic backtracking on adversarial inputs.
// The pattern ([a-zA-Z0-9.]+)* creates nested quantifiers where the dot
// is matched by both the character class and the outer repetition,
// causing exponential backtracking when input ends with an invalid character.
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
