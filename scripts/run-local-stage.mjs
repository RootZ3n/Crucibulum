#!/usr/bin/env node
/**
 * Luak — run one Stage of the local campaign against one deployed artifact.
 *
 * A Stage is: for each declared regime, run a suite's split N times, sequentially,
 * against the artifact currently loaded — and write the records, the verbatim
 * completions and a derived identity for each regime separately.
 *
 * ## Why the regimes never share a file
 *
 * `unconstrained` and `json_schema` measure different capabilities. Under the
 * first the model is responsible for its own JSON and a malformed answer is its
 * failure; under the second the runtime constrains generation and a malformed
 * answer means the guarantee was not kept. A single number over both says
 * neither thing, and the exporter's homogeneity checks exist precisely to refuse
 * a bundle that mixed them. So each regime gets its own records file, its own
 * completions file and its own identity — and the identity carries
 * `generation.regime`, so the separation survives being read back later by
 * something that has forgotten how the files were produced.
 *
 * ## What it will not do
 *
 * No retries. A failed attempt is kept exactly as it happened. A harness that
 * retried and reported the second answer would be reporting a capability the
 * model does not have on the first try, and the first try is what a caller gets.
 * The runner's own per-attempt precondition already aborts a run when the
 * deployment changes underneath it, which is the only correct response to a
 * restart mid-campaign.
 *
 * Nothing here decides whether a result is good. Thresholds are not this
 * script's to invent and are not set anywhere yet.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const LUAK = '/home/zen/repos/luak';

function usage() {
  console.error(
    'usage: run-local-stage.mjs --model <modelId> --suite <suiteId> --out-dir <dir>\n' +
    '                          [--repeats N] [--split evaluation|development|both]\n' +
    '                          [--regimes unconstrained,json_schema] [--schema <file.json>]\n' +
    '                          [--context-tier <label>]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};

const modelId = flag('model', null);
const suiteId = flag('suite', null);
const outDir = flag('out-dir', null);
if (!modelId || !suiteId || !outDir) usage();

const repeats = Number(flag('repeats', 3));
const split = flag('split', 'evaluation');
const regimes = flag('regimes', 'unconstrained,json_schema').split(',').map((s) => s.trim()).filter(Boolean);
const schemaPath = flag('schema', null);
const contextTier = flag('context-tier', 'control');

const catalog = JSON.parse(readFileSync('/home/zen/repos/bokahli/catalog/artifacts.json', 'utf8'));
// Found by identity, never at index zero: a catalog is advertised in whatever
// order it was loaded, and the campaign's artifact is the one it names.
const artifact = catalog.artifacts.find((a) => a.modelId === modelId);
if (!artifact) {
  console.error(`no artifact "${modelId}" in the Bokahli catalog`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

/**
 * The responder config for one regime.
 *
 * Written per run rather than kept as a file somebody edits, so the exact
 * configuration a set of records was produced under is reconstructible from the
 * command that produced them. It carries no secret: the credential is a path.
 */
function configFor(regime) {
  const cfg = {
    configVersion: 'bokahli-responder-config-1.2.0',
    endpoint: 'http://127.0.0.1:8080',
    modelId,
    artifactDigest: artifact.digest,
    expectedRuntimeBuild: catalog.backends.primary.pinnedBuild,
    contextTier,
    requestTimeoutMs: 600_000,
    firstTokenTimeoutMs: 240_000,
    stream: false,
    credential: { kind: 'file', path: join(HOME, '.config/bokahli/token') },
    sampler: { temperature: 0, topP: 1, maxTokens: 1024 },
    regime,
  };
  if (regime === 'json_schema') {
    if (schemaPath === null) {
      console.error('--schema is required when the json_schema regime is requested');
      process.exit(2);
    }
    cfg.outputSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  }
  return cfg;
}

const results = [];
for (const regime of regimes) {
  const tag = `${modelId}.${suiteId}.${regime}`;
  const cfgPath = join(outDir, `${tag}.config.json`);
  const outPath = join(outDir, `${tag}.records.json`);
  writeFileSync(cfgPath, `${JSON.stringify(configFor(regime), null, 2)}\n`);

  console.log(`\n=== ${tag} — ${repeats} repeat(s), split=${split} ===`);
  let stdout = '';
  let failed = null;
  try {
    stdout = execFileSync(
      'taskset',
      [
        '-c', '0-7,10-23',
        'node', join(LUAK, 'dist/cli/main.js'), 'local-qualify',
        '--suite', suiteId,
        '--split', split,
        '--repeats', String(repeats),
        '--out', outPath,
        '--responder', 'bokahli',
        '--responder-config', cfgPath,
      ],
      { cwd: LUAK, encoding: 'utf8', timeout: 3 * 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    stdout = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    failed = err.message;
  }
  process.stdout.write(stdout);
  writeFileSync(join(outDir, `${tag}.run.log`), stdout);

  // The summary is computed from the records rather than scraped from the log:
  // a number read out of console output is a number nobody can re-derive.
  let summary = null;
  try {
    const d = JSON.parse(readFileSync(outPath, 'utf8'));
    summary = summarise(d);
  } catch (err) {
    summary = { error: `records unreadable: ${err.message}` };
  }
  results.push({ regime, tag, recordsPath: outPath, failed, summary });
}

/**
 * Per-lane, per-attribution counts, kept apart.
 *
 * Deliberately not collapsed into a score. Grounding, fabrication, abstention,
 * structured-output validity and injection behaviour have different causes and
 * different remedies, and an operator choosing a model needs to see which one
 * moved. Collapsing them early is how a model that is excellent at one and
 * unusable at another reads as mediocre at both.
 */
function summarise(d) {
  const outcomes = {};
  const attributions = {};
  const codes = {};
  const lanes = {};
  let injectionPresent = 0;
  let injectionObeyed = 0;
  let injectionDetected = 0;
  let structuredValid = 0;
  let structuredTotal = 0;

  for (const [rec, s] of d.records.map((r, i) => [r, d.scored[i]])) {
    outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    attributions[s.attribution] = (attributions[s.attribution] ?? 0) + 1;
    for (const c of s.failureCodes) codes[c] = (codes[c] ?? 0) + 1;
    for (const l of rec.lanes) {
      lanes[l.lane] ??= { attempts: 0, withFailure: 0, attribution: new Set() };
      lanes[l.lane].attempts += 1;
      if (l.failureCodes.length) lanes[l.lane].withFailure += 1;
      lanes[l.lane].attribution.add(l.attribution);
      const m = Object.fromEntries(l.measurements.map((x) => [x.name, x.value]));
      if (l.lane === 'injection') {
        if (m['injection.present'] === 1) injectionPresent += 1;
        if (m['injection.obeyed'] === 1) injectionObeyed += 1;
        if (m['injection.detected'] === 1) injectionDetected += 1;
      }
      if (l.lane === 'structured_output') {
        structuredTotal += 1;
        if (m['structuredOutput.valid'] === 1) structuredValid += 1;
      }
    }
  }
  return {
    attempts: d.records.length,
    abortedReason: d.abortedReason ?? null,
    tokenCountSource: d.tokenCountSource,
    outcomes,
    attributions,
    failureCodes: codes,
    lanes: Object.fromEntries(
      Object.entries(lanes).map(([k, v]) => [k, {
        attempts: v.attempts, withFailure: v.withFailure, attribution: [...v.attribution],
      }]),
    ),
    injection: { present: injectionPresent, obeyed: injectionObeyed, detected: injectionDetected },
    structuredOutput: { valid: structuredValid, total: structuredTotal },
  };
}

const summaryPath = join(outDir, `${modelId}.${suiteId}.stage-summary.json`);
writeFileSync(summaryPath, `${JSON.stringify({ modelId, suiteId, split, repeats, results }, null, 2)}\n`);
console.log(`\nstage summary: ${summaryPath}`);
for (const r of results) {
  const s = r.summary ?? {};
  console.log(`  ${r.regime.padEnd(14)} attempts=${s.attempts ?? '?'} ` +
    `outcomes=${JSON.stringify(s.outcomes ?? {})} ` +
    `structured=${s.structuredOutput?.valid}/${s.structuredOutput?.total} ` +
    `injection obeyed=${s.injection?.obeyed} detected=${s.injection?.detected}` +
    (r.failed ? `  FAILED: ${r.failed}` : ''));
}
void dirname;
