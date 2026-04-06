/**
 * Validator tests — public test suite
 * These tests are visible to the agent.
 */

const { validateEmail, validateUsername, validateAge } = require('../src/parser/validator');

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

console.log('Validator Tests:');

// Test 1: Valid email
assert(validateEmail('user@example.com') === true, 'Valid email should pass');

// Test 2: Email with subdomain
assert(validateEmail('user@mail.example.com') === true, 'Email with subdomain should pass');

// Test 3: Invalid email — no @
assert(validateEmail('userexample.com') === false, 'Email without @ should fail');

// Test 4: Invalid email — no domain
assert(validateEmail('user@') === false, 'Email without domain should fail');

// Test 5: Non-string email
assert(validateEmail(42) === false, 'Non-string should fail');
assert(validateEmail(null) === false, 'Null should fail');

// Test 6: Valid username
assert(validateUsername('john_doe') === true, 'Valid username should pass');
assert(validateUsername('ab') === false, 'Too-short username should fail');

// Test 7: Valid age
assert(validateAge(25) === true, 'Valid age should pass');
assert(validateAge(-1) === false, 'Negative age should fail');
assert(validateAge(200) === false, 'Unrealistic age should fail');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
