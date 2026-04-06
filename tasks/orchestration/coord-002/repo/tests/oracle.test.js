const { calculateTotal } = require('../src/orders/pricing');
const { processOrder } = require('../src/orders/receipt');
const { seedStock, clearStock } = require('../src/orders/inventory');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

function run() {
  console.log('Order pipeline oracle tests (hidden)\n');

  // Test 1: Exact total with no discount
  // Items: 2x $25 = $50, tax 8% = $4, total = $54
  const items1 = [{ name: 'Gadget', price: 25, qty: 2 }];
  const r1 = calculateTotal(items1, 0);
  assert(r1.subtotal === 50, `No-discount subtotal is 50 (got ${r1.subtotal})`);
  assert(r1.tax === 4, `No-discount tax is 4 (got ${r1.tax})`);
  assert(r1.total === 54, `No-discount total is 54 (got ${r1.total})`);

  // Test 2: Exact total with 10% discount
  // Items: 5x $20 = $100, discount 10% = $10, subtotal after discount = $90
  // Tax: $90 * 0.08 = $7.20, total = $90 + $7.20 = $97.20
  const items2 = [{ name: 'Doohickey', price: 20, qty: 5 }];
  const r2 = calculateTotal(items2, 10);
  assert(r2.subtotal === 90, `10%-discount subtotal is 90 (got ${r2.subtotal})`);
  assert(r2.discount === 10, `10%-discount amount is 10 (got ${r2.discount})`);
  assert(r2.tax === 7.2, `10%-discount tax is 7.20 (got ${r2.tax})`);
  assert(r2.total === 97.2, `10%-discount total is 97.20 (got ${r2.total})`);

  // Test 3: Discount applied exactly once — total should be subtotal + tax
  // If discount is applied twice, total would be subtotal - discount + tax = 90 - 10 + 7.20 = 87.20
  assert(
    r2.total === r2.subtotal + r2.tax,
    `Total equals subtotal + tax (no double discount): ${r2.total} === ${r2.subtotal} + ${r2.tax}`
  );

  // Test 4: Full pipeline with discount — receipt total matches manual calc
  clearStock();
  seedStock([{ name: 'Thingamajig', available: 50 }]);
  const items3 = [{ name: 'Thingamajig', price: 40, qty: 3 }];
  // Subtotal: 120, discount 25% = 30, after discount = 90, tax = 7.20, total = 97.20
  const order = processOrder('Charlie', items3, 25);
  assert(order.success === true, 'Discounted order processes successfully');
  assert(order.receipt.discount === 30, `Receipt discount is 30 (got ${order.receipt.discount})`);
  assert(order.receipt.total === 97.2, `Receipt total is 97.20 (got ${order.receipt.total})`);

  // Test 5: Multiple items with discount
  clearStock();
  seedStock([
    { name: 'A', available: 10 },
    { name: 'B', available: 10 },
  ]);
  const items4 = [
    { name: 'A', price: 15, qty: 2 },
    { name: 'B', price: 30, qty: 1 },
  ];
  // Subtotal: 30 + 30 = 60, discount 50% = 30, after discount = 30, tax = 2.40, total = 32.40
  const r4 = calculateTotal(items4, 50);
  assert(r4.total === 32.4, `50%-discount multi-item total is 32.40 (got ${r4.total})`);

  clearStock();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
