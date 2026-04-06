/**
 * Billing calculator — computes order totals with discounts.
 * All internal math is in cents to avoid floating point.
 */

function calculateSubtotal(items) {
  let subtotal = 0;
  for (const item of items) {
    if (!item.priceCents || !item.quantity) continue;
    if (item.quantity < 0) throw new Error('Negative quantity not allowed');
    subtotal += item.priceCents * item.quantity;
  }
  return subtotal;
}

function applyDiscount(subtotalCents, discountPercent) {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100');
  }
  // BUG: Math.floor truncates — should be Math.round
  const discountCents = Math.floor(subtotalCents * discountPercent / 100);
  return { discountCents, totalCents: subtotalCents - discountCents };
}

function calculateTotal(items, discountPercent = 0) {
  const subtotalCents = calculateSubtotal(items);
  const { discountCents, totalCents } = applyDiscount(subtotalCents, discountPercent);
  return {
    subtotalCents,
    discountCents,
    totalCents,
    totalDollars: totalCents / 100
  };
}

module.exports = { calculateSubtotal, applyDiscount, calculateTotal };
