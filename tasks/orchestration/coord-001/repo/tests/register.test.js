const { register } = require('../src/users/register');
const { clearUsers, getAllUsers } = require('../src/users/store');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('Register tests (public)\n');

  // Reset state
  clearUsers();

  // Test 1: Register a valid user
  const result = await register('alice@example.com', 'Alice');
  assert(result.success === true, 'Valid registration succeeds');
  assert(result.user && result.user.email === 'alice@example.com', 'Returned user has correct email');

  // Test 2: saveUser is called and user is stored
  const users = getAllUsers();
  assert(users.length === 1, 'User is stored in the database');
  assert(users[0].name === 'Alice', 'Stored user has correct name');

  // Test 3: Register a second valid user
  const result2 = await register('bob@example.com', 'Bob');
  assert(result2.success === true, 'Second registration succeeds');

  const users2 = getAllUsers();
  assert(users2.length === 2, 'Two users stored');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
