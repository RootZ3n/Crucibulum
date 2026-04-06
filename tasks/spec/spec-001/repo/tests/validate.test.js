/**
 * Validation tests — public test suite
 * These tests are visible to the agent.
 */

const { handleValidation, validateEmail } = require('../src/api/validate');

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

console.log('Validation Tests:');

// Test 1: Valid input should return valid: true
const r1 = handleValidation({ email: 'test@example.com', name: 'John' });
assert(r1.body.valid === true, 'Valid input should return valid: true');

// Test 2: Invalid email should return errors
const r2 = handleValidation({ email: 'bad', name: 'John' });
assert(r2.body.valid === false, 'Invalid email should return valid: false');
assert(r2.body.errors.length > 0, 'Invalid email should return errors array');
assert(r2.body.errors.includes('Invalid email'), 'Should include "Invalid email" error');

// Test 3: Short name should return errors
const r3 = handleValidation({ email: 'ok@test.com', name: 'J' });
assert(r3.body.valid === false, 'Short name should return valid: false');
assert(r3.body.errors.includes('Name too short'), 'Should include "Name too short" error');

// Test 4: Multiple errors at once
const r4 = handleValidation({ email: 'bad', name: 'J' });
assert(r4.body.errors.length === 2, 'Multiple invalid fields should return multiple errors');

// Test 5: Missing fields
const r5 = handleValidation({});
assert(r5.body.valid === false, 'Empty input should return valid: false');
assert(r5.body.errors.length >= 2, 'Empty input should have multiple errors');

// Test 6: Valid email helper
assert(validateEmail('test@example.com') === true, 'validateEmail should accept valid email');
assert(validateEmail('bad') === false, 'validateEmail should reject invalid email');

// Test 7: Null input
const r7 = handleValidation(null);
assert(r7.body.valid === false, 'Null input should return valid: false');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
