/**
 * Public test suite for config loader.
 * DO NOT MODIFY — tests/ directory is read-only during evaluation.
 */

const { parseKeyValue } = require('../src/config/parser');

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
  console.log('config.test.js — public tests\n');

  // Test 1: Parser handles key-value pairs
  const parsed = parseKeyValue('port=8080\nhost=0.0.0.0\ndebug=true');
  assert(parsed.port === 8080, 'parser reads numeric value');
  assert(parsed.host === '0.0.0.0', 'parser reads string value');
  assert(parsed.debug === true, 'parser reads boolean value');

  // Test 2: Parser skips comments and blank lines
  const withComments = parseKeyValue('# comment\n\nkey=value\n# another');
  assert(Object.keys(withComments).length === 1, 'parser skips comments');
  assert(withComments.key === 'value', 'parser reads value after comments');

  // Test 3: Parser throws on invalid format
  let threw = false;
  try {
    parseKeyValue('invalid_line_no_equals');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'parser throws on invalid format');

  // Test 4: Init loads config correctly
  // Fresh require to get clean module state
  delete require.cache[require.resolve('../src/config/loader')];
  const { init, getConfig } = require('../src/config/loader');
  await init();
  const cfg = getConfig();
  assert(cfg.port === 8080, 'config has loaded port after init');
  assert(cfg.host === '0.0.0.0', 'config has loaded host after init');
  assert(cfg.debug === true, 'config has loaded debug after init');
  assert(cfg.maxConnections === 100, 'config has loaded maxConnections after init');

  // Test 5: getConfig returns merged defaults + loaded
  assert(cfg.timeout === 30000, 'config has loaded timeout');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
