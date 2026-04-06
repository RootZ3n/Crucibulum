/**
 * Pricing module — calculates subtotal, discount, tax, and total.
 */
const TAX_RATE = 0.08;

function calculateTotal(items, discountPercent) {
  let subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  const discount = subtotal * (discountPercent / 100);
  subtotal = subtotal - discount;

  const tax = subtotal * TAX_RATE;
  const total = subtotal - discount + tax;

  return {
    subtotal: round(subtotal),
    discount: round(discount),
    tax: round(tax),
    total: round(total),
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateTotal, TAX_RATE };
