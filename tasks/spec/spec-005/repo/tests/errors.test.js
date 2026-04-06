/**
 * Error handling tests — public test suite
 * These tests are visible to the agent.
 */

const { formatError, createError, handleRouteError } = require('../src/api/errors');

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

console.log('Error Handling Tests:');

// Test 1: formatError returns status code
const err1 = new Error('Something went wrong');
const r1 = formatError(err1, 500);
assert(r1.status === 500, 'Should include status code');

// Test 2: formatError includes error message
assert(typeof r1.error === 'string', 'Should include error message string');
assert(r1.error.length > 0, 'Error message should not be empty');

// Test 3: createError sets properties
const err2 = createError('Not found', 404, 'NOT_FOUND');
assert(err2.message === 'Not found', 'createError should set message');
assert(err2.statusCode === 404, 'createError should set statusCode');
assert(err2.code === 'NOT_FOUND', 'createError should set code');

// Test 4: handleRouteError returns formatted response
const err3 = createError('Bad request', 400, 'BAD_INPUT');
const r3 = handleRouteError(err3, { method: 'POST', url: '/api/test' });
assert(r3.status === 400, 'handleRouteError should return correct status');

// Test 5: Default status code
const err4 = new Error('Unknown error');
const r4 = handleRouteError(err4, { method: 'GET', url: '/api/test' });
assert(r4.status === 500, 'Should default to 500 for errors without statusCode');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
