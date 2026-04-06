/**
 * Input validation endpoint handler.
 * Validates user registration input and returns validation result.
 *
 * Spec: POST /validate
 *   - Valid input: 200 { valid: true }
 *   - Invalid input: 422 { valid: false, errors: [...] }
 */

function handleValidation(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return { status: 400, body: { valid: false, errors: ['Invalid request body'] } };
  }

  if (!input.email || typeof input.email !== 'string' || !input.email.includes('@')) {
    errors.push('Invalid email');
  }

  if (!input.name || typeof input.name !== 'string' || input.name.length < 2) {
    errors.push('Name too short');
  }

  if (input.age !== undefined && (typeof input.age !== 'number' || input.age < 0 || input.age > 150)) {
    errors.push('Invalid age');
  }

  if (errors.length > 0) {
    return { status: 200, body: { valid: false, errors } };  // BUG: should be 422
  }

  return { status: 200, body: { valid: true } };
}

function validateEmail(email) {
  return typeof email === 'string' && email.includes('@') && email.length > 3;
}

module.exports = { handleValidation, validateEmail };
