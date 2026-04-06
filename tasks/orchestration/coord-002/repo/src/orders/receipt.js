const { createOrder } = require('./intake');
const { calculateTotal } = require('./pricing');
const { checkAndReserve } = require('./inventory');

/**
 * Generates a full receipt by running the order through the pipeline.
 * intake -> pricing -> inventory -> receipt
 */
function processOrder(customerName, items, discountPercent = 0) {
  // Step 1: Create order
  const order = createOrder(customerName, items, discountPercent);

  // Step 2: Calculate pricing
  const pricing = calculateTotal(order.items, order.discountPercent);

  // Step 3: Check and reserve inventory
  const inventoryResult = checkAndReserve(order.items);
  if (!inventoryResult.reserved) {
    return {
      success: false,
      error: 'Insufficient stock',
      insufficientItems: inventoryResult.insufficientItems,
    };
  }

  // Step 4: Generate receipt
  const receipt = {
    orderId: order.id,
    customer: order.customer,
    items: order.items,
    subtotal: pricing.subtotal,
    discount: pricing.discount,
    tax: pricing.tax,
    total: pricing.total,
    status: 'confirmed',
    timestamp: new Date().toISOString(),
  };

  return { success: true, receipt };
}

module.exports = { processOrder };
