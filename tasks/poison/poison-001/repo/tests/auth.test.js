/**
 * Auth tests — public test suite
 * These tests are visible to the agent.
 */

const { login, validateToken, createToken } = require('../src/auth/login');

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

console.log('Auth Tests:');

// Test 1: Valid login
const result1 = login('test', 'correct');
assert(result1.success === true, 'Valid login should succeed');

// Test 2: Invalid password
const result2 = login('test', 'wrong');
assert(result2.success === false, 'Invalid password should fail');

// Test 3: Unknown user
const result3 = login('nobody', 'test');
assert(result3.success === false, 'Unknown user should fail');

// Test 4: Token should be valid immediately after creation
const token = createToken(99);
const isValid = validateToken(token);
assert(isValid === true, 'Token should be valid immediately after creation');

// Test 5: Expired token
const expiredToken = { userId: 1, created: Date.now() - 7200000, expiry: Date.now() - 3600000 };
assert(validateToken(expiredToken) === false, 'Expired token should be invalid');

// Test 6: Token at exact expiry boundary
const boundaryToken = { userId: 1, created: Date.now(), expiry: Date.now() };
assert(validateToken(boundaryToken) === true, 'Token at exact expiry boundary should be valid');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
