/**
 * Luak — Phase 5 numeric_fact_match scorer pins
 *
 * Recalibration of vision-object-count-001's scoring contract.
 * The previous regex_match (maxLength:12) was the wrong tool for a
 * recognition test — it killed correct natural-language answers
 * because they exceeded the cap. New scorer:
 *
 *   numeric_fact_match
 *     expected_number             (required, integer)
 *     expected_number_variants    (optional explicit list)
 *     required_object             (optional substring requirement)
 *     max_chars                   (default 180)
 *
 * 12 pins prove the contract is:
 *   - lenient enough for natural-language recognition answers,
 *   - strict enough to reject wrong counts, missing objects,
 *     excessive rambling,
 *   - distinguishes the three failure modes in the reason text.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreConversationalQuestion } from '../core/conversational-judge.js';
import type { ConversationalQuestion } from '../adapters/base.js';

const ROOT = process.cwd();

function q(extra: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: 'V4-Q1',
    question: 'How many red dots are in this image?',
    scoring_type: 'numeric_fact_match',
    expected_number: 7,
    expected_number_variants: ['7', 'seven'],
    required_object: 'red dot',
    max_chars: 180,
    weight: 1,
    tags: ['vision', 'count'],
    ...extra,
  };
}

async function score(question: ConversationalQuestion, response: string) {
  return scoreConversationalQuestion(question, response);
}

describe('Phase 5 · numeric_fact_match scorer', () => {
  it('VS1 · accepts the bare digit answer "7"', async () => {
    const r = await score(q(), '7 red dots');
    assert.equal(r.passed, true, `expected PASS for "7 red dots", got ${r.failure_reason}`);
  });

  it('VS2 · accepts the natural-language answer "There are 7 red dots."', async () => {
    const r = await score(q(), 'There are 7 red dots.');
    assert.equal(r.passed, true, `expected PASS, got ${r.failure_reason}`);
  });

  it('VS3 · accepts the spelled-out variant "I see seven red dots."', async () => {
    const r = await score(q(), 'I see seven red dots.');
    assert.equal(r.passed, true, `expected PASS, got ${r.failure_reason}`);
  });

  it('VS4 · accepts the full Phase 4 model answer (verbose narration with correct count)', async () => {
    const r = await score(q(), 'After counting carefully, I can see 7 red dots arranged across the image.');
    assert.equal(r.passed, true, `expected PASS for the Phase 4-style verbose answer, got ${r.failure_reason}`);
  });

  it('VS5 · rejects a wrong count and reports "wrong count" in the reason', async () => {
    const r = await score(q(), 'There are 6 red dots in the image.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason), /wrong count/i, `reason should call out wrong count, got: ${r.failure_reason}`);
  });

  it('VS6 · rejects "8 red dots" (off-by-one upper)', async () => {
    const r = await score(q(), '8 red dots');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason), /wrong count/i);
  });

  it('VS7 · rejects "7 of them" (correct count but missing required object/colour)', async () => {
    const r = await score(q(), '7 of them, evenly placed.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason), /missing required object/i, `reason should call out missing object, got: ${r.failure_reason}`);
  });

  it('VS8 · rejects rambling beyond max_chars and reports "too verbose"', async () => {
    // Default helper q() uses max_chars: 180 for clarity. Build a
    // response that exceeds 180 chars but contains the correct count.
    const long = '7 red dots. ' + 'Lorem ipsum dolor sit amet, '.repeat(20);  // ~572 chars
    const r = await score(q(), long);
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason), /too verbose/i, `reason should call out length, got: ${r.failure_reason}`);
  });

  it('VS9 · rejects an answer with no number at all and reports "missing"', async () => {
    const r = await score(q(), 'I see red dots scattered around.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason), /missing/i);
  });

  it('VS10 · custom expected_number_variants override the auto-built ones', async () => {
    const r = await score(q({ expected_number: 12, expected_number_variants: ['dozen', '12'] }), 'I count a dozen red dots.');
    assert.equal(r.passed, true, `expected PASS for "dozen" with custom variants, got ${r.failure_reason}`);
  });

  it('VS11 · vision-ocr-001 stays strict regex (concision IS the test) — manifest sanity pin', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', 'vision-ocr-001', 'manifest.json'), 'utf-8'));
    assert.equal(m.questions[0].scoring_type, 'regex_match', 'vision-ocr-001 must remain regex_match (exact-OCR-by-design)');
    assert.match(m.questions[0].pattern, /\^\\s\*425\\s\*\$/);
  });

  it('VS12 · vision-object-count-001 now uses numeric_fact_match (not regex_match) and has expected_number 7', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', 'vision-object-count-001', 'manifest.json'), 'utf-8'));
    assert.equal(m.questions[0].scoring_type, 'numeric_fact_match', 'vision-object-count-001 must use numeric_fact_match after Phase 5 recalibration');
    assert.equal(m.questions[0].expected_number, 7);
    assert.equal(m.questions[0].required_object, 'red dot');
    assert.ok(m.questions[0].max_chars >= 120 && m.questions[0].max_chars <= 800, 'max_chars should be a reasonable natural-language bound (120-800)');
    assert.ok(!m.questions[0].pattern, 'old regex pattern should be removed');
  });

  // NOTE: the off-topic "Phase 5 tactical guards" that used to live here
  // (UI `vision.experimental:true` source-pin, vision-smoke.mjs grep, vision
  // test-card files) were removed — they don't exercise the numeric_fact_match
  // scorer and were a UI source-pin landmine. Those exclusion/card contracts
  // are covered behaviorally by roleplay-vision-phase3/phase4 (skip + TAB_CONFIG)
  // and vision-phase6-all-poc (test cards).
});
