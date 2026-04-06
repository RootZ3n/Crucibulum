/**
 * Date formatting tests — public test suite
 * These tests are visible to the agent.
 */

const { formatDate, parseDate } = require('../src/utils/dates');

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

console.log('Date Formatting Tests:');

// Test 1: Output matches ISO-like format
const result = formatDate('2024-06-15T12:00:00Z');
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(result), 'Output should match date-time format');

// Test 2: Output is parseable back to a Date
const parsed = new Date(result);
assert(!isNaN(parsed.getTime()), 'Output should be parseable as a Date');

// Test 3: Accepts timestamp number
const fromTimestamp = formatDate(1718452800000);
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(fromTimestamp), 'Should format from timestamp');

// Test 4: Accepts Date object
const fromDate = formatDate(new Date('2024-01-01T00:00:00Z'));
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(fromDate), 'Should format from Date object');

// Test 5: Invalid date throws
try {
  formatDate('not-a-date');
  assert(false, 'Should throw on invalid date');
} catch (e) {
  assert(true, 'Throws on invalid date');
}

// Test 6: parseDate works
const p = parseDate('2024-06-15T12:00:00Z');
assert(p instanceof Date, 'parseDate should return a Date');

// Test 7: No milliseconds in output
assert(!/\.\d{3}/.test(result), 'Output should not include milliseconds');

// Test 8: Year is 4 digits
assert(/^20\d{2}/.test(result), 'Year should be 4 digits starting with 20');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
