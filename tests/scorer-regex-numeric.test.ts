/**
 * Luak — scorer correctness for regex_match numeric tests
 *
 * Pins the contract on `^\s*N\s*$`-style scorers used by the
 * token-efficiency family. After the 2026-05-25 audit (where an
 * operator suspected the 425 test was malformed because a model
 * answer "6" was shown alongside the 425 pattern — actually two
 * separate Q1/Q4 failures conflated in the UI), we lock the
 * behavior so a future change can't loosen these tests silently.
 *
 * What this pins:
 *   1. The exact pattern accepts only the bare number (with
 *      surrounding whitespace).
 *   2. The exact pattern REJECTS verbose responses (16 tickets,
 *      sixteen, 16.0, etc.) — that strictness is the point of the
 *      token-efficiency family.
 *   3. Manifest expected answers for token-efficiency-001 (Q1..Q5)
 *      are mathematically correct under the only defensible
 *      interpretation of each prompt.
 *   4. Each manifest pattern matches its expected numeric answer.
 *   5. The maxLength budget admits the canonical answer plus
 *      one-line whitespace.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreConversationalQuestion } from '../core/conversational-judge.js';

const ROOT = process.cwd();
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'tasks', 'token-efficiency', 'token-efficiency-001', 'manifest.json'), 'utf-8'),
);

interface Question {
  id: string;
  question: string;
  scoring_type: string;
  pattern: string;
  maxLength: number;
}

const QUESTIONS = MANIFEST.questions as Question[];

// Hand-verified canonical answers for each prompt. If a future edit
// changes the prompt text but forgets the expected answer, this map
// detects the drift.
const CANONICAL: Record<string, number> = {
  'TE1-Q1': 16,   // 18 - 7 + 2 + 5 - 2
  'TE1-Q2': 125,  // 240 - 85 + 30 - 60
  'TE1-Q3': 94,   // 92 - 14 + 3 + 21 - 8
  'TE1-Q4': 425,  // 530 - 142 + 75 - 38
  'TE1-Q5': 42,   // 47 - 12 + 4 + 9 - 6
};

function compilePattern(p: string): RegExp {
  // The manifest stores the pattern as a JSON string with escaped
  // backslashes — e.g. "^\\s*16\\s*$" lives in JSON as the string
  // "^\s*16\s*$". JSON.parse already unescaped, so feed it directly.
  return new RegExp(p);
}

describe('Luak scorer: regex_match (numeric, token-efficiency)', () => {
  it('S1 · every TE1-QN manifest pattern accepts its canonical numeric answer', () => {
    for (const q of QUESTIONS) {
      const re = compilePattern(q.pattern);
      const expected = String(CANONICAL[q.id]);
      assert.ok(re.test(expected), `${q.id}: pattern ${q.pattern} must accept canonical answer "${expected}"`);
      assert.ok(re.test(`  ${expected}\n`), `${q.id}: pattern must allow leading/trailing whitespace around "${expected}"`);
      assert.ok(re.test(`\t${expected}`), `${q.id}: pattern must allow leading tab around "${expected}"`);
    }
  });

  it('S2 · every TE1-QN manifest pattern REJECTS verbose responses (the point of token-efficiency)', () => {
    for (const q of QUESTIONS) {
      const re = compilePattern(q.pattern);
      const expected = String(CANONICAL[q.id]);
      // Verbose alternatives that a less-careful model might emit.
      const rejects = [
        `${expected} tickets`,
        `${expected}.0`,
        `${expected},`,
        `Answer: ${expected}`,
        `${expected}\nthat's the count`,
        // Plain English number
        ({ 16: 'sixteen', 125: 'one hundred twenty five', 94: 'ninety-four', 425: 'four hundred twenty-five', 42: 'forty-two' } as Record<number, string>)[CANONICAL[q.id]],
      ].filter(Boolean) as string[];
      for (const verbose of rejects) {
        assert.ok(!re.test(verbose), `${q.id}: pattern ${q.pattern} must REJECT verbose "${verbose}" (token-efficiency family enforces concision)`);
      }
    }
  });

  it('S3 · canonical answers fit within maxLength budget', () => {
    for (const q of QUESTIONS) {
      const expected = String(CANONICAL[q.id]);
      assert.ok(expected.length <= q.maxLength, `${q.id}: canonical answer "${expected}" (${expected.length} chars) must fit maxLength=${q.maxLength}`);
    }
  });

  it('S4 · TE1-Q4 specifically — the 425 case that prompted this audit', () => {
    const q = QUESTIONS.find((x) => x.id === 'TE1-Q4')!;
    assert.equal(q.pattern, '^\\s*425\\s*$', 'TE1-Q4 pattern must remain ^\\s*425\\s*$');
    const re = compilePattern(q.pattern);
    assert.ok(re.test('425'), 'TE1-Q4 must accept bare 425');
    assert.ok(re.test('  425  '), 'TE1-Q4 must accept padded 425');
    assert.ok(!re.test('6'), 'TE1-Q4 must reject 6 (model answer in the audited bundle)');
    assert.ok(!re.test('351'), 'TE1-Q4 must reject 351 (actual model answer in the audited bundle)');
    assert.ok(!re.test('425 books'), 'TE1-Q4 must reject verbose 425 + suffix');
  });

  it('S5 · TE1-Q1 specifically — the "Got: 6" case that the operator first noticed', () => {
    const q = QUESTIONS.find((x) => x.id === 'TE1-Q1')!;
    assert.equal(q.pattern, '^\\s*16\\s*$', 'TE1-Q1 pattern must remain ^\\s*16\\s*$');
    const re = compilePattern(q.pattern);
    assert.ok(re.test('16'), 'TE1-Q1 must accept 16');
    assert.ok(!re.test('6'), 'TE1-Q1 must reject 6 (the actual wrong model answer in the audited bundle)');
    // Defence in depth: 6 must not partially-match a 16 pattern.
    assert.ok(!re.test('60'), 'TE1-Q1 must reject 60');
    assert.ok(!re.test('06'), 'TE1-Q1 must reject 06');
  });

  it('S6 · TE1-Q4 prompt + canonical answer are mathematically consistent', () => {
    // 530 - 142 + 75 - 38 = 425. Pin the arithmetic so a future prompt
    // edit can't drift away from the expected answer without flagging.
    const q = QUESTIONS.find((x) => x.id === 'TE1-Q4')!;
    const numbers = (q.question.match(/\d+/g) || []).map(Number);
    assert.deepEqual(numbers, [530, 142, 75, 38], 'TE1-Q4 prompt must mention exactly [530, 142, 75, 38] in order');
    assert.equal(530 - 142 + 75 - 38, 425, 'TE1-Q4 arithmetic identity: 530 - 142 + 75 - 38 = 425');
  });

  it('S7 · failure messages identify the actual pattern + got value (no silent fail)', () => {
    const q1 = QUESTIONS.find((x) => x.id === 'TE1-Q1')!;
    const q4 = QUESTIONS.find((x) => x.id === 'TE1-Q4')!;
    const failures = [
      scoreConversationalQuestion(q1 as never, '6'),
      scoreConversationalQuestion(q4 as never, '351'),
    ];
    for (const scored of failures) {
      assert.equal(scored.passed, false);
      assert.match(scored.failure_reason ?? '', /^Response did not match pattern \/[^/]+\/[a-z]*\. Got: /, `scorer error format must name the pattern AND the got value: ${scored.failure_reason}`);
    }
  });
});
