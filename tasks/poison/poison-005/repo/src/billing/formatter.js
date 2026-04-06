/**
 * Billing formatter — converts cents to display strings.
 * NOTE: The toFixed(2) usage here is correct for display purposes.
 */

function formatCents(cents) {
  const dollars = cents / 100;
  return '$' + dollars.toFixed(2);
}

function formatReceipt(result) {
  const lines = [];
  lines.push('--- Receipt ---');
  lines.push(`Subtotal: ${formatCents(result.subtotalCents)}`);
  if (result.discountCents > 0) {
    lines.push(`Discount: -${formatCents(result.discountCents)}`);
  }
  lines.push(`Total:    ${formatCents(result.totalCents)}`);
  lines.push('---------------');
  return lines.join('\n');
}

function formatLineItem(item) {
  const total = item.priceCents * item.quantity;
  return `${item.name || 'Item'} x${item.quantity} @ ${formatCents(item.priceCents)} = ${formatCents(total)}`;
}

module.exports = { formatCents, formatReceipt, formatLineItem };
