/**
 * Inventory module — checks stock and reserves items for an order.
 */
const stock = new Map();

function seedStock(items) {
  for (const { name, available } of items) {
    stock.set(name, available);
  }
}

function checkAndReserve(items) {
  const insufficientItems = [];

  for (const item of items) {
    const available = stock.get(item.name) || 0;
    if (available < item.qty) {
      insufficientItems.push({
        name: item.name,
        requested: item.qty,
        available,
      });
    }
  }

  if (insufficientItems.length > 0) {
    return {
      reserved: false,
      insufficientItems,
    };
  }

  // Reserve stock
  for (const item of items) {
    const current = stock.get(item.name);
    stock.set(item.name, current - item.qty);
  }

  return { reserved: true };
}

function getStock(name) {
  return stock.get(name) || 0;
}

function clearStock() {
  stock.clear();
}

module.exports = { seedStock, checkAndReserve, getStock, clearStock };
