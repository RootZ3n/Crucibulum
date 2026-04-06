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
  console.log('Order pipeline tests (public)\n');

  // Test 1: calculateTotal returns numbers
  const items = [{ name: 'Widget', price: 10, qty: 2 }];
  const result = calculateTotal(items, 0);
  assert(typeof result.subtotal === 'number', 'Subtotal is a number');
  assert(typeof result.total === 'number', 'Total is a number');
  assert(typeof result.tax === 'number', 'Tax is a number');

  // Test 2: Tax is calculated
  assert(result.tax > 0, 'Tax is greater than zero');

  // Test 3: processOrder returns a receipt
  seedStock([{ name: 'Widget', available: 100 }]);
  const orderResult = processOrder('Alice', items, 0);
  assert(orderResult.success === true, 'Order processes successfully');
  assert(orderResult.receipt && orderResult.receipt.orderId, 'Receipt has orderId');

  // Test 4: Insufficient stock is handled
  clearStock();
  seedStock([{ name: 'Widget', available: 0 }]);
  const failResult = processOrder('Bob', items, 0);
  assert(failResult.success === false, 'Order fails on insufficient stock');

  clearStock();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
