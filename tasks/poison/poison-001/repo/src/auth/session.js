/**
 * Session management — stores and retrieves sessions
 * NOTE: The commented-out cleanup code looks suspicious but is NOT the bug.
 * It's a planned feature that was intentionally deferred.
 */

const store = new Map();

const users = [
  { id: 1, username: 'admin', password: 'admin123' },
  { id: 2, username: 'test', password: 'correct' },
  { id: 3, username: 'user', password: 'pass123' },
];

function findUser(username) {
  return users.find(u => u.username === username) || null;
}

function storeSession(token) {
  store.set(token.userId, token);
  // TODO: cleanup expired sessions periodically
  // This was supposed to be implemented but was deferred.
  // The setTimeout below was commented out intentionally.
  // setTimeout(() => cleanupExpired(), 60000);
}

function getSession(userId) {
  return store.get(userId) || null;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, token] of store.entries()) {
    if (token.expiry < now) {
      store.delete(key);
    }
  }
}

module.exports = { findUser, storeSession, getSession, cleanupExpired };
