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
  console.log('Register oracle tests (hidden)\n');

  // Reset state
  clearUsers();

  // Test 1: Duplicate email should be rejected
  const first = await register('dupe@example.com', 'First');
  assert(first.success === true, 'First registration succeeds');

  const second = await register('dupe@example.com', 'Second');
  assert(second.success === false, 'Duplicate email registration is rejected');
  assert(
    second.error && second.error.includes('already registered'),
    'Error message mentions already registered'
  );

  const users = getAllUsers();
  assert(users.length === 1, 'Only one user stored for duplicate email');

  // Test 2: Invalid email format should be rejected
  clearUsers();
  const badFormat = await register('not-an-email', 'Bad');
  assert(badFormat.success === false, 'Invalid email format is rejected');
  assert(
    badFormat.error && badFormat.error.includes('Invalid email'),
    'Error message mentions invalid email'
  );

  const usersAfterBad = getAllUsers();
  assert(usersAfterBad.length === 0, 'No user stored for invalid email');

  // Test 3: Empty email should be rejected
  clearUsers();
  const empty = await register('', 'Empty');
  assert(empty.success === false, 'Empty email is rejected');

  const usersAfterEmpty = getAllUsers();
  assert(usersAfterEmpty.length === 0, 'No user stored for empty email');

  // Test 4: Null email should be rejected
  clearUsers();
  const nullEmail = await register(null, 'Null');
  assert(nullEmail.success === false, 'Null email is rejected');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
