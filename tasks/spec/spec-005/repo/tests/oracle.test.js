/**
 * Oracle tests — hidden test suite
 * Tests that error responses do NOT leak internal paths or stack traces.
 */

const { formatError, handleRouteError, createError } = require('../src/api/errors');

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

function containsPath(obj) {
  const str = JSON.stringify(obj);
  // Check for Unix paths, Windows paths, and source references
  return /\/home\//.test(str) ||
         /\/src\//.test(str) ||
         /\/app\//.test(str) ||
         /\/usr\//.test(str) ||
         /\.js:\d+/.test(str) ||
         /at\s+\w+\s+\(/.test(str) ||
         /node_modules/.test(str) ||
         /C:\\/.test(str);
}

console.log('Oracle Tests (Error Path Leak):');

// Test 1: Error with file path in message should be sanitized
const err1 = new Error("ENOENT: no such file or directory, open '/home/app/data/users/42.json'");
const r1 = formatError(err1, 404);
assert(!containsPath(r1), 'Error response must not contain internal file paths');
assert(r1.status === 404, 'Status code should still be present');

// Test 2: path field should not expose stack trace
const err2 = new Error('Something failed');
const r2 = formatError(err2, 500);
assert(r2.path === null || r2.path === undefined || !containsPath({ p: r2.path }),
  'path field must not contain stack trace frames');

// Test 3: Complex error message with path
const err3 = new Error("Cannot read file /src/config/database.js:42 — permission denied");
const r3 = formatError(err3, 403);
assert(!containsPath(r3), 'Source file references must be stripped from error');

// Test 4: handleRouteError also sanitizes
const err4 = createError(
  "Module /home/app/node_modules/broken/index.js threw an error",
  500,
  'MODULE_ERROR'
);
const r4 = handleRouteError(err4, { method: 'GET', url: '/api/broken' });
assert(!containsPath(r4), 'handleRouteError must sanitize paths from response');
assert(r4.status === 500, 'Status should still work after sanitization');

// Test 5: Error code should still be preserved
const err5 = createError('Failed at /home/app/src/auth.js', 401, 'AUTH_FAILED');
const r5 = formatError(err5, 401);
assert(r5.code === 'AUTH_FAILED', 'Error code should be preserved');
assert(!containsPath(r5), 'Path in message must be sanitized');

// Test 6: Clean error messages should pass through
const err6 = new Error('Invalid email address');
const r6 = formatError(err6, 400);
assert(r6.error === 'Invalid email address' || r6.error.includes('Invalid email'),
  'Clean error messages should pass through intact');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
