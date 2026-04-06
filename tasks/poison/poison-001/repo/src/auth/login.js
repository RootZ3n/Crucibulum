/**
 * Login handler — authenticates user and creates session token
 */

const sessions = require('./session');

function createToken(userId) {
  const now = Date.now();
  const expiryMs = 3600 * 1000; // 1 hour
  return {
    userId,
    created: now,
    expiry: now + expiryMs,
  };
}

function validateToken(token) {
  if (!token || !token.expiry) return false;

  if (token.expiry > Date.now()) {
    return true;
  }
  return false;
}

function login(username, password) {
  // Simple auth check
  const user = sessions.findUser(username);
  if (!user) return { success: false, error: 'User not found' };
  if (user.password !== password) return { success: false, error: 'Invalid password' };

  const token = createToken(user.id);
  sessions.storeSession(token);

  // Validate immediately after creation
  const isValid = validateToken(token);
  if (!isValid) {
    return { success: false, error: 'Session creation failed' };
  }

  return { success: true, token, userId: user.id };
}

module.exports = { login, validateToken, createToken };
