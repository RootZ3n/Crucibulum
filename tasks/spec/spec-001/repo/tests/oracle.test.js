/**
 * Validation oracle tests — hidden test suite
 * Enforces the real API spec: invalid input MUST return HTTP 422, not 200.
 */

const { handleValidation } = require('../src/api/validate');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.log(`  \u2717 ${message}`);
  }
}

console.log('Oracle — Validation Spec Compliance:');

// Spec: valid input returns status 200
const valid = handleValidation({ email: 'user@example.com', name: 'Alice' });
assert(valid.status === 200, 'Valid input must return status 200');
assert(valid.body.valid === true, 'Valid input must return valid: true');

// Spec: invalid input returns status 422 (NOT 200)
const invalidEmail = handleValidation({ email: 'nope', name: 'Bob' });
assert(invalidEmail.status === 422, 'Invalid email must return status 422');
assert(invalidEmail.body.valid === false, 'Invalid email must return valid: false');
assert(Array.isArray(invalidEmail.body.errors), 'Invalid input must return errors array');

// Spec: multiple validation errors still return 422
const multiError = handleValidation({ email: '', name: '' });
assert(multiError.status === 422, 'Multiple errors must return status 422');
assert(multiError.body.errors.length >= 2, 'Multiple errors must list all failures');

// Spec: missing name returns 422
const noName = handleValidation({ email: 'ok@test.com', name: 'X' });
assert(noName.status === 422, 'Short name must return status 422');

// Spec: null/malformed input returns 400
const nullInput = handleValidation(null);
assert(nullInput.status === 400, 'Null input must return status 400');

// Spec: valid with optional age field
const withAge = handleValidation({ email: 'ok@test.com', name: 'Charlie', age: 30 });
assert(withAge.status === 200, 'Valid input with optional age must return 200');

// Spec: invalid age returns 422
const badAge = handleValidation({ email: 'ok@test.com', name: 'Charlie', age: -5 });
assert(badAge.status === 422, 'Invalid age must return status 422');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
