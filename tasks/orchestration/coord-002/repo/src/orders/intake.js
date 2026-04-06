/**
 * Order intake — receives raw order data and creates a structured order object.
 */
function createOrder(customerName, items, discountPercent = 0) {
  if (!customerName || typeof customerName !== 'string') {
    throw new Error('Customer name is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one item is required');
  }

  for (const item of items) {
    if (!item.name || typeof item.price !== 'number' || typeof item.qty !== 'number') {
      throw new Error(`Invalid item: ${JSON.stringify(item)}`);
    }
    if (item.price < 0 || item.qty < 1) {
      throw new Error(`Item price must be >= 0 and qty >= 1`);
    }
  }

  return {
    id: `ORD-${Date.now()}`,
    customer: customerName,
    items: items.map((i) => ({ ...i })),
    discountPercent,
    status: 'created',
    createdAt: new Date().toISOString(),
  };
}

module.exports = { createOrder };
