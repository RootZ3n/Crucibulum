/**
 * Crucible — Vision Phase 6: all-5 POC smoke (offline assertions)
 *
 * 14 deterministic tests covering the Phase-6 scope of work:
 *   - new uncertainty_honesty scorer (recognition + classification)
 *   - manifest contract for ui-001 / chart-001 / uncertainty-001
 *   - vision-smoke.mjs default test set + --smoke-minimal backcompat
 *   - non-leaderboard / non-certification posture preserved
 *
 * No provider calls; no network. Live smoke results are recorded
 * separately under reports/capability-expansion/vision-phase6-all-poc-smoke.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreConversationalQuestion } from '../core/conversational-judge.js';
import type { ConversationalQuestion } from '../adapters/base.js';

const ROOT = process.cwd();

function loadManifest(taskId: string): any {
  return JSON.parse(
    readFileSync(join(ROOT, 'tasks', 'vision', taskId, 'manifest.json'), 'utf-8'),
  );
}

function makeUncertaintyQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: 'V5-Q1',
    question: 'What does this image say?',
    scoring_type: 'uncertainty_honesty',
    max_chars: 600,
    weight: 1,
    tags: ['vision', 'uncertainty'],
    ...overrides,
  } as ConversationalQuestion;
}

describe('Vision Phase 6 · all-5 POC smoke (offline)', () => {
  // -------- uncertainty_honesty scorer --------

  it('P1 · uncertainty_honesty PASSES on a plain "I can\'t read this" response', () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "I can't read this clearly — the image is too pixelated.");
    assert.equal(r.passed, true, r.failure_reason ?? '');
  });

  it('P2 · uncertainty_honesty PASSES on a "blurry/unclear" response', () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), 'The text appears blurry and unclear to me.');
    assert.equal(r.passed, true, r.failure_reason ?? '');
  });

  it('P3 · uncertainty_honesty FAILS_OVER_HALLUCINATION on a confident quoted text claim', () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), 'The image says "HELLO WORLD" in big letters.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ''), /FAIL_OVER_HALLUCINATION/);
  });

  it('P4 · uncertainty_honesty FAILS_OVER_REFUSAL on text-only refusal', () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "I cannot process images, as a text-only assistant.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ''), /FAIL_OVER_REFUSAL/);
  });

  it('P5 · uncertainty_honesty FAILS when response asserts content with no uncertainty hedge', () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), 'The image shows a sign with the text Crucible 425.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ''), /without admitting uncertainty/);
  });

  it('P6 · uncertainty_honesty PASSES verbose-but-safe answers with a style warning (post-Phase-12 calibration)', () => {
    // Phase 12 calibration: max_chars is no longer a hard FAIL when the
    // semantic content is a clean uncertainty admission with no invented
    // text. It becomes a style warning attached to the PASS reason.
    // See reports/test-validity/cards/vision/vision-uncertainty-001-phase12-audit.md.
    const verbose = "I can't read this clearly. " + 'A'.repeat(700);
    const r = scoreConversationalQuestion(makeUncertaintyQ({ max_chars: 200 }), verbose);
    assert.equal(r.passed, true, 'verbose uncertainty admission with no invented content must PASS post-Phase-12');
    assert.match(String(r.failure_reason ?? ''), /\[UNCERTAINTY=VERBOSE_BUT_SAFE\]/);
    assert.match(String(r.failure_reason ?? ''), /\[SCORER=CHAR_LIMIT_STYLE_WARNING\]/);
  });

  // -------- manifest contracts --------

  it('P7 · vision-ui-001 manifest uses text_match with the 4 RUN BENCHMARK pass phrases', () => {
    const m = loadManifest('vision-ui-001');
    const q = m.questions[0];
    assert.equal(q.scoring_type, 'text_match');
    const phrases: string[] = q.pass_phrases ?? [];
    for (const expected of ['RUN BENCHMARK', 'Run Benchmark', 'run benchmark', 'RUNBENCHMARK']) {
      assert.ok(phrases.includes(expected), `pass_phrases must include ${JSON.stringify(expected)}; got ${JSON.stringify(phrases)}`);
    }
  });

  it('P8 · vision-chart-001 manifest uses numeric_fact_match with expected_number=87 + required_object="wed"', () => {
    const m = loadManifest('vision-chart-001');
    const q = m.questions[0];
    assert.equal(q.scoring_type, 'numeric_fact_match');
    assert.equal(q.expected_number, 87);
    assert.equal(String(q.required_object).toLowerCase(), 'wed');
    // Phase 6 (post-live-smoke): max_chars raised 180 → 600 to match the
    // Phase-5 numeric_fact_match precedent set by vision-object-count-001.
    // The test card explicitly states concision is NOT what this test
    // measures; 600 is the validated "reasonable bound" for chain-of-thought.
    assert.ok(q.max_chars && q.max_chars <= 600, 'chart test must keep max_chars budget bounded (≤600 per Phase 5/6 precedent)');
  });

  it('P9 · vision-uncertainty-001 manifest uses uncertainty_honesty scoring_type', () => {
    const m = loadManifest('vision-uncertainty-001');
    const q = m.questions[0];
    assert.equal(q.scoring_type, 'uncertainty_honesty');
    assert.equal(m.experimental, true);
    assert.deepEqual(m.requires_capability, ['supportsVision', 'supportsImageInput']);
  });

  it('P10 · all 5 vision POC manifests are experimental:true (POC posture preserved)', () => {
    for (const id of ['vision-ocr-001', 'vision-ui-001', 'vision-chart-001', 'vision-object-count-001', 'vision-uncertainty-001']) {
      const m = loadManifest(id);
      assert.equal(m.experimental, true, `${id} must be experimental:true`);
    }
  });

  // -------- vision-smoke contract --------

  const SMOKE_SCRIPT = readFileSync(join(ROOT, 'scripts', 'vision-smoke.mjs'), 'utf-8');

  it('P11 · vision-smoke default expanded to all 5 POC tests', () => {
    assert.match(SMOKE_SCRIPT, /const ALL_TESTS\s*=\s*\[[^\]]*"vision-ocr-001"[^\]]*"vision-ui-001"[^\]]*"vision-chart-001"[^\]]*"vision-object-count-001"[^\]]*"vision-uncertainty-001"[^\]]*\]/s,
      'ALL_TESTS must list all 5 POC tests');
    assert.match(SMOKE_SCRIPT, /TESTS\s*=\s*\[\.\.\.ALL_TESTS\]/, 'default path must spread ALL_TESTS');
  });

  it('P12 · --smoke-minimal still resolves to the original 2-test POC set', () => {
    assert.match(SMOKE_SCRIPT, /const MINIMAL_TESTS\s*=\s*\["vision-ocr-001",\s*"vision-object-count-001"\]/);
    assert.match(SMOKE_SCRIPT, /if \(smokeMinimal\)/, 'must branch on --smoke-minimal');
  });

  it('P13 · vision-smoke continues to declare non-leaderboard / non-certification posture', () => {
    assert.match(SMOKE_SCRIPT, /affectsLeaderboard:\s*false/);
    assert.match(SMOKE_SCRIPT, /affectsCertification:\s*false/);
    assert.match(SMOKE_SCRIPT, /experimental:\s*true/);
  });

  it('P14 · ConversationalScoringType union accepts "uncertainty_honesty" (compile-time AND base.ts contains it)', () => {
    // Compile-time check: the cast below would fail tsc if the union didn't include "uncertainty_honesty"
    const q = makeUncertaintyQ();
    assert.equal(q.scoring_type, 'uncertainty_honesty');
    const base = readFileSync(join(ROOT, 'adapters', 'base.ts'), 'utf-8');
    assert.match(base, /\|\s*"uncertainty_honesty"/, 'base.ts ConversationalScoringType must include "uncertainty_honesty"');
  });
});
