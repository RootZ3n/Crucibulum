/**
 * Billing tests — public test suite
 * These tests are visible to the agent.
 */

const { calculateTotal, calculateSubtotal, applyDiscount } = require('../src/billing/calculator');

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

console.log('Billing Tests:');

// Test 1: Basic total no discount
const r1 = calculateTotal([{ priceCents: 1000, quantity: 2 }]);
assert(r1.subtotalCents === 2000, 'Subtotal should be 2000 cents');
assert(r1.totalCents === 2000, 'Total with 0% discount should equal subtotal');

// Test 2: 10% discount on round number
const r2 = calculateTotal([{ priceCents: 1000, quantity: 1 }], 10);
assert(r2.discountCents === 100, '10% of 1000 should be 100');
assert(r2.totalCents === 900, 'Total should be 900 after 10% discount');

// Test 3: Multiple items
const r3 = calculateTotal([
  { priceCents: 500, quantity: 3 },
  { priceCents: 250, quantity: 2 }
]);
assert(r3.subtotalCents === 2000, 'Multiple items subtotal correct');

// Test 4: Zero discount
const r4 = calculateTotal([{ priceCents: 9999, quantity: 1 }], 0);
assert(r4.totalCents === 9999, 'Zero discount leaves total unchanged');

// Test 5: 50% discount on even number
const r5 = calculateTotal([{ priceCents: 2000, quantity: 1 }], 50);
assert(r5.discountCents === 1000, '50% of 2000 is 1000');
assert(r5.totalCents === 1000, 'Total after 50% discount');

// Test 6: Invalid discount
let threw = false;
try { calculateTotal([{ priceCents: 100, quantity: 1 }], 150); } catch (e) { threw = true; }
assert(threw, 'Should throw for discount > 100');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
