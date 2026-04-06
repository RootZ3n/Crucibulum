// In-memory user store (simulates a database)
const users = [];

async function saveUser({ email, name }) {
  const user = {
    id: users.length + 1,
    email,
    name,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  return user;
}

async function findByEmail(email) {
  return users.find((u) => u.email === email) || null;
}

function getAllUsers() {
  return [...users];
}

function clearUsers() {
  users.length = 0;
}

module.exports = { saveUser, findByEmail, getAllUsers, clearUsers };
