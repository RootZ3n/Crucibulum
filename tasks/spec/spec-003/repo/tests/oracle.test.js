/**
 * Date formatting oracle tests — hidden test suite
 * Enforces the real spec: output must be UTC with trailing Z.
 * Run with: TZ=America/New_York node tests/oracle.test.js
 */

const { formatDate } = require('../src/utils/dates');

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

console.log('Oracle — Date Formatting Spec Compliance:');

// Spec: known timestamp must produce exact UTC string
// 2024-06-15T12:00:00Z = 1718452800000
const r1 = formatDate(1718452800000);
assert(r1 === '2024-06-15T12:00:00Z', `Expected "2024-06-15T12:00:00Z", got "${r1}"`);

// Spec: midnight UTC boundary
// 2024-01-01T00:00:00Z = 1704067200000
const r2 = formatDate(1704067200000);
assert(r2 === '2024-01-01T00:00:00Z', `Expected "2024-01-01T00:00:00Z", got "${r2}"`);

// Spec: end of day UTC
// 2024-12-31T23:59:59Z = 1735689599000
const r3 = formatDate(1735689599000);
assert(r3 === '2024-12-31T23:59:59Z', `Expected "2024-12-31T23:59:59Z", got "${r3}"`);

// Spec: output must end with Z
assert(r1.endsWith('Z'), 'Output must end with Z');
assert(r2.endsWith('Z'), 'Midnight output must end with Z');
assert(r3.endsWith('Z'), 'End-of-day output must end with Z');

// Spec: string input should also produce UTC
const r4 = formatDate('2024-06-15T12:00:00Z');
assert(r4 === '2024-06-15T12:00:00Z', `String input: expected "2024-06-15T12:00:00Z", got "${r4}"`);

// Spec: Date object input
const r5 = formatDate(new Date('2024-03-10T05:30:00Z'));
assert(r5 === '2024-03-10T05:30:00Z', `Date input: expected "2024-03-10T05:30:00Z", got "${r5}"`);

// Spec: no milliseconds
assert(!/\.\d{3}/.test(r1), 'Output must not include milliseconds');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
