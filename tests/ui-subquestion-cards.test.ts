/**
 * Crucible — sub-question failure card pins
 *
 * Follow-up to the 2026-05-25 "425 vs 6" audit: each failed
 * sub-question in the focused-run inspector must render as its own
 * clearly-bounded card with the QID, expected pattern, and model
 * answer in separately-labeled fields so a reader can NEVER
 * cross-read field labels between two adjacent failures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');

describe('Crucible sub-question failure cards', () => {
  it('SQ1 · renderSubQuestionFailures function exists and is mounted into renderFocusedRun', () => {
    assert.ok(HTML.includes('function renderSubQuestionFailures'), 'renderSubQuestionFailures function missing');
    // Mounted in renderFocusedRun above the Test Review Explorer subpanel.
    const focusedStart = HTML.indexOf('function renderFocusedRun(tabKey)');
    assert.ok(focusedStart > 0, 'renderFocusedRun not found');
    const focusedBody = HTML.slice(focusedStart, focusedStart + 12000);
    assert.ok(focusedBody.includes('renderSubQuestionFailures(result)'), 'renderFocusedRun must invoke renderSubQuestionFailures(result)');
    // And it appears BEFORE LAYER C (Test Review Explorer) so failed
    // sub-questions surface first.
    const sqIdx = focusedBody.indexOf('renderSubQuestionFailures(result)');
    const layerCIdx = focusedBody.indexOf('LAYER C');
    assert.ok(sqIdx > 0 && layerCIdx > 0 && sqIdx < layerCIdx, 'renderSubQuestionFailures must mount BEFORE LAYER C in renderFocusedRun');
  });

  it('SQ2 · normalizeRunForDisplay enriches timeline errors with subQuestion {qid, expectedPattern, modelAnswer, reason}', () => {
    // The enrichment lives inside normalizeRunForDisplay's
    // timeline-error mapping path.
    const fnStart = HTML.indexOf('function normalizeRunForDisplay');
    assert.ok(fnStart > 0, 'normalizeRunForDisplay missing');
    const fnBody = HTML.slice(fnStart, fnStart + 16000);
    assert.ok(/subQuestion\s*:\s*\{/.test(fnBody), 'normalizeRunForDisplay must attach a subQuestion object to each timeline-error detail');
    // Each field appears either as `name: value` or as object-shorthand
    // `name,` / `name\n` inside the subQuestion block.
    const subqBlock = fnBody.match(/subQuestion\s*:\s*\{[\s\S]*?\}/);
    assert.ok(subqBlock, 'subQuestion block not extractable');
    for (const k of ['qid', 'expectedPattern', 'modelAnswer', 'reason']) {
      assert.ok(new RegExp(`\\b${k}\\b`).test(subqBlock![0]), `subQuestion field ${k} missing`);
    }
    // The QID extractor must match the `TE1-Q1`-style id family.
    assert.ok(/qidMatch[\s\S]{0,100}\^\(\[A-Z\]\+/.test(fnBody), 'QID regex must accept the TE1-Q1 family pattern');
    // The pattern extractor must capture the regex literal.
    assert.ok(/patternMatch[\s\S]{0,100}pattern\\s\+\(\\\//.test(fnBody) || /pattern\\s\+\(\\\/[^/]\+\\\/[a-z]\*\)/.test(fnBody), 'pattern extractor must capture the /…/ literal');
  });

  it('SQ3 · CSS gives each sub-question card a strong visual boundary', () => {
    assert.ok(CSS.includes('.subq-card'), 'missing .subq-card CSS');
    // Must use a thick left rail in red (the failure color) so the
    // boundary between cards is impossible to miss.
    const cardRule = CSS.match(/\.subq-card\{[\s\S]*?\n\}/);
    assert.ok(cardRule, '.subq-card rule not found');
    assert.ok(/border-left:\s*[3-9]px solid var\(--red\)/.test(cardRule![0]) || /border-left:\s*[3-9]px solid #/.test(cardRule![0]) || /border-left:\s*\d+px solid/.test(cardRule![0]), '.subq-card must use a thick (>=3px) coloured left border');
    assert.ok(/padding:\s*\d+px/.test(cardRule![0]), '.subq-card must have non-trivial padding');
    // Cards must be in a grid with gap so they don't visually touch.
    assert.ok(/\.subq-list\{[^}]*gap:\s*\d+px/.test(CSS), '.subq-list must have a non-zero gap between cards');
  });

  it('SQ4 · QID badge is prominent and unique per card (cannot be cross-read)', () => {
    assert.ok(CSS.includes('.subq-badge'), 'missing .subq-badge CSS');
    const badge = CSS.match(/\.subq-badge\{[\s\S]*?\n\}/);
    assert.ok(badge, '.subq-badge rule missing');
    assert.ok(/font-family:var\(--mono\)|font-family:.*mono/i.test(badge![0]), '.subq-badge must use monospace font for unambiguous QID rendering');
    assert.ok(/font-weight:\s*[6-9]\d\d/.test(badge![0]), '.subq-badge must be bold (>= 600 weight)');
    assert.ok(/min-width:\s*\d+px/.test(badge![0]) || /padding:\s*\d+px\s+\d+px/.test(badge![0]), '.subq-badge must have explicit min-width or padding so QID never wraps weirdly');
  });

  it('SQ5 · Expected and Got fields are visually distinct (different colour treatments)', () => {
    // Expected stays cyan, Got uses red so a reader instantly sees
    // which value is the model's wrong answer.
    assert.ok(/\.subq-code\{[\s\S]*?color:\s*var\(--cyan\)/.test(CSS), '.subq-code must default to cyan (expected pattern colour)');
    const gotRule = CSS.match(/\.subq-code\.subq-got\{[\s\S]*?\n\}/);
    assert.ok(gotRule, '.subq-code.subq-got rule missing');
    assert.ok(/color:\s*#ff[a-f0-9]{2,4}/i.test(gotRule![0]) || /color:\s*var\(--red\)/.test(gotRule![0]), '.subq-code.subq-got must use a red-ish colour to distinguish from .subq-code');
  });

  it('SQ6 · render output uses labelled <dt>/<dd> rows so labels can never be reassigned', () => {
    // The cards use a <dl class="subq-grid"> with <dt>label</dt><dd>value</dd>.
    // This semantic pairing means a screen reader (and a sighted
    // reader scanning quickly) cannot reassign Q4's "Expected pattern"
    // dt to Q1's "Got" dd.
    const fnStart = HTML.indexOf('function renderSubQuestionFailures');
    const body = HTML.slice(fnStart, fnStart + 4000);
    assert.ok(/<dl class="subq-grid">/.test(body), 'sub-question card must use <dl class="subq-grid">');
    assert.ok(/<dt>Expected pattern<\/dt>/.test(body), 'Expected pattern row missing');
    assert.ok(/<dt>Model answered<\/dt>/.test(body), 'Model answered row missing');
    assert.ok(/<dt>Pass\/fail reason<\/dt>/.test(body), 'Pass/fail reason row missing');
  });

  it('SQ7 · ARIA: each card is its own role=group with a labelled heading', () => {
    const fnStart = HTML.indexOf('function renderSubQuestionFailures');
    const body = HTML.slice(fnStart, fnStart + 4000);
    assert.ok(/role="group"/.test(body), 'sub-question card must use role="group"');
    assert.ok(/aria-labelledby="subq-/.test(body), 'sub-question card must reference its own labelled title via aria-labelledby');
  });
});
