/**
 * Oracle tests — hidden test suite
 * These tests verify the actual fix was applied correctly.
 * Tests target rounding edge cases that Math.floor gets wrong.
 */

const { calculateTotal, applyDiscount } = require('../src/billing/calculator');

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

console.log('Oracle Tests (Billing Rounding):');

// Test 1: 15% discount on $99.99 (9999 cents)
// 9999 * 15 / 100 = 1499.85 → should round to 1500, floor gives 1499
const r1 = calculateTotal([{ priceCents: 9999, quantity: 1 }], 15);
assert(r1.discountCents === 1500, '15% of 9999 should be 1500 (rounded), not 1499 (floored)');
assert(r1.totalCents === 8499, 'Total after 15% on 9999 should be 8499');

// Test 2: 33% discount on $7.77 (777 cents)
// 777 * 33 / 100 = 256.41 → should round to 256, floor gives 256 (same here)
// Actually let's pick: 777 * 33 / 100 = 256.41 — both floor and round give 256. Pick better values.
// 33% of 7777 = 2566.41 → floor 2566, round 2566 — same again
// 15% of 333 = 49.95 → floor 49, round 50
const r2 = applyDiscount(333, 15);
assert(r2.discountCents === 50, '15% of 333 should be 50 (rounded), not 49 (floored)');
assert(r2.totalCents === 283, 'Total after 15% on 333 should be 283');

// Test 3: 7% discount on $14.29 (1429 cents)
// 1429 * 7 / 100 = 100.03 → floor 100, round 100 — same. Try:
// 7% of 1435 = 100.45 → floor 100, round 100. Try:
// 23% of 999 = 229.77 → floor 229, round 230
const r3 = applyDiscount(999, 23);
assert(r3.discountCents === 230, '23% of 999 should be 230 (rounded), not 229 (floored)');
assert(r3.totalCents === 769, 'Total after 23% on 999 should be 769');

// Test 4: Multiple items with odd-cent totals
// 3 items at 333 cents + 2 items at 777 cents = 999 + 1554 = 2553
// 17% of 2553 = 434.01 → floor 434, round 434 — same. Try:
// 13% of 2553 = 331.89 → floor 331, round 332
const r4 = calculateTotal([
  { priceCents: 333, quantity: 3 },
  { priceCents: 777, quantity: 2 }
], 13);
assert(r4.subtotalCents === 2553, 'Subtotal should be 2553');
assert(r4.discountCents === 332, '13% of 2553 should be 332 (rounded), not 331 (floored)');
assert(r4.totalCents === 2221, 'Total should be 2221');

// Test 5: Edge case — discount that produces .5 exactly
// 25% of 2 = 0.5 → floor 0, round 1 (banker's rounding aside, Math.round rounds .5 up)
const r5 = applyDiscount(2, 25);
assert(r5.discountCents === 1, '25% of 2 cents should be 1 (rounded from 0.5), not 0 (floored)');
assert(r5.totalCents === 1, 'Total should be 1 cent');

// Test 6: Regression — round numbers still work
const r6 = calculateTotal([{ priceCents: 1000, quantity: 5 }], 20);
assert(r6.discountCents === 1000, '20% of 5000 should still be 1000');
assert(r6.totalCents === 4000, 'Total should be 4000');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
