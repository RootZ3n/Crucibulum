/**
 * Hidden oracle tests — verifies getConfig() fails safely before init().
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL: ${msg}`);
  }
}

async function runTests() {
  console.log('oracle.test.js — hidden tests\n');

  // Test 1: getConfig() before init() should throw or indicate uninitialized
  // Fresh require to get clean module state (init has NOT been called)
  delete require.cache[require.resolve('../src/config/loader')];
  const { getConfig, getConfigValue, init } = require('../src/config/loader');

  let threwOnColdStart = false;
  try {
    const coldConfig = getConfig();
    // If it returns defaults silently, that's the bug — it should throw
    if (coldConfig.port === 3000 && coldConfig.host === 'localhost') {
      // Got default values — this is the buggy behavior
      threwOnColdStart = false;
    }
  } catch (e) {
    threwOnColdStart = true;
  }
  assert(threwOnColdStart, 'getConfig() throws before init() is called');

  // Test 2: getConfigValue() before init() should also throw
  let threwOnValue = false;
  try {
    getConfigValue('port');
  } catch (e) {
    threwOnValue = true;
  }
  assert(threwOnValue, 'getConfigValue() throws before init() is called');

  // Test 3: After init(), getConfig() should work normally
  await init();
  let worksAfterInit = false;
  try {
    const cfg = getConfig();
    worksAfterInit = cfg.port === 8080 && cfg.host === '0.0.0.0';
  } catch (e) {
    worksAfterInit = false;
  }
  assert(worksAfterInit, 'getConfig() works correctly after init()');

  // Test 4: getConfigValue() works after init
  let valueWorks = false;
  try {
    valueWorks = getConfigValue('port') === 8080;
  } catch (e) {
    valueWorks = false;
  }
  assert(valueWorks, 'getConfigValue() returns correct value after init()');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
