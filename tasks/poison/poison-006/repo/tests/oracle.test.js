/**
 * Oracle tests — hidden test suite
 * Tests that email validation completes in bounded time for adversarial inputs.
 * The buggy regex causes catastrophic backtracking on these inputs.
 */

const { validateEmail } = require('../src/parser/validator');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.log(`  \u2717 ${message}`);
  }
}

function timedValidation(email) {
  const start = Date.now();
  const result = validateEmail(email);
  const elapsed = Date.now() - start;
  return { result, elapsed };
}

console.log('Oracle Tests (Regex Performance):');

// Test 1: 28-char adversarial input — triggers catastrophic backtracking
// With the buggy regex, this takes >500ms. With a fix, <5ms.
const adversarial1 = 'a'.repeat(28) + '!';
const t1 = timedValidation(adversarial1);
assert(t1.result === false, 'Adversarial input should be rejected');
assert(t1.elapsed < 100, `Adversarial input 1 (28 chars) must complete in <100ms (took ${t1.elapsed}ms)`);

// Test 2: 30-char adversarial input — even worse with the bug
const adversarial2 = 'a'.repeat(30) + '#';
const t2 = timedValidation(adversarial2);
assert(t2.result === false, 'Adversarial input 2 should be rejected');
assert(t2.elapsed < 100, `Adversarial input 2 (30 chars) must complete in <100ms (took ${t2.elapsed}ms)`);

// Test 3: Mixed alphanumeric adversarial input
const adversarial3 = 'ab1cd2ef3gh4ij5kl6mn7op8qr9' + '!';
const t3 = timedValidation(adversarial3);
assert(t3.result === false, 'Mixed adversarial input should be rejected');
assert(t3.elapsed < 100, `Adversarial input 3 must complete in <100ms (took ${t3.elapsed}ms)`);

// Test 4: Valid emails should still work
const t4 = timedValidation('user@example.com');
assert(t4.result === true, 'Valid email should still pass');
assert(t4.elapsed < 50, `Valid email must complete quickly (took ${t4.elapsed}ms)`);

// Test 5: Complex valid email
const t5 = timedValidation('first.last@sub.domain.co.uk');
assert(t5.result === true, 'Complex valid email should pass');

// Test 6: Empty and null checks still work
assert(validateEmail('') === false, 'Empty string should be rejected');
assert(validateEmail(null) === false, 'Null should be rejected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
