/**
 * Example routes — uses error handling.
 */

const { createError, handleRouteError } = require('./errors');
const fs = require('fs');

function getUser(id) {
  try {
    // Simulated file-based user lookup
    const data = fs.readFileSync(`/home/app/data/users/${id}.json`, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    // The error message from fs will contain the full path
    throw createError(err.message, 404, 'USER_NOT_FOUND');
  }
}

function processPayment(amount) {
  if (amount <= 0) {
    throw createError('Invalid payment amount', 400, 'INVALID_AMOUNT');
  }
  // Simulated processing
  return { success: true, amount };
}

module.exports = { getUser, processPayment };
