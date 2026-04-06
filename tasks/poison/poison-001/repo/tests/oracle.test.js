/**
 * Hidden oracle tests — NEVER shown to agent
 * Tests the exact boundary condition that the bug causes.
 */

const { validateToken } = require('../src/auth/login');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; }
  else { failed++; console.log(`  FAIL: ${message}`); }
}

// Test the exact boundary: token.expiry === Date.now()
// With the bug (>), this returns false. With the fix (>=), this returns true.
const now = Date.now();
const boundaryToken = { userId: 1, created: now, expiry: now };
assert(validateToken(boundaryToken) === true, 'Token at exact expiry boundary should be valid (>= not >)');

// Token 1ms before expiry should be valid
const almostExpired = { userId: 1, created: now - 3599999, expiry: now + 1 };
assert(validateToken(almostExpired) === true, 'Token 1ms before expiry should be valid');

// Token at expiry should still be valid (>= means equal counts as valid)
const atExpiry = { userId: 1, created: now - 3600000, expiry: now };
assert(validateToken(atExpiry) === true, 'Token at exact expiry should be valid with >=');

// Already expired token should be invalid
const expired = { userId: 1, created: now - 3600001, expiry: now - 1 };
assert(validateToken(expired) === false, 'Past-expiry token should be invalid');

if (failed > 0) {
  console.log(`Oracle tests: ${passed} passed, ${failed} FAILED`);
  process.exit(1);
} else {
  console.log(`Oracle tests: ${passed} passed`);
}
