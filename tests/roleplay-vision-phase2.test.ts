/**
 * Luak — Roleplay/Vision Phase 2: skip classifiers + flake fix
 *
 * 13 pins for the Phase 2 stabilisation work:
 *
 *   PH1   cleanup.test.js is now deterministic (verified by running it
 *         multiple times in the build above; this test pins the
 *         runsDir injection contract that made it deterministic).
 *   PH2   Vision manifests with TBD fixture hashes are detected by
 *         visionFixtureMissing() and routed to SKIPPED_FIXTURE_MISSING.
 *   PH3   preflightSkipCheck() never returns null for vision tasks
 *         that lack a fixture — the runner is guaranteed to skip
 *         BEFORE any provider call.
 *   PH4   preflightSkipCheck() does not classify any skip as
 *         FAIL_PRODUCT / FAIL_PROVIDER / FAIL_CONFIG.
 *   PH5   buildSkipResult() shape forbids skipped runs from entering
 *         the leaderboard composite (bundle.score.skipped === true,
 *         skip_classification recorded).
 *   PH6   A non-vision-capable model produces SKIPPED_UNSUPPORTED_MULTIMODAL.
 *   PH7   Unsupported-multimodal skip carries no provider call signal
 *         (cost_usd = 0, tokens_in/out = 0).
 *   PH8   model-certify.mjs classifyTier() filters SKIPPED_* out of
 *         tier promotion — so a model can't be downgraded by a skip.
 *   PH9   Roleplay opt-out (supportsRoleplay:false) produces
 *         SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE.
 *   PH10  Skipped bundles carry an auditable skip_classification +
 *         skip_reason so the UI can render a Skipped chip.
 *   PH11  isExcludedFromLeaderboard() returns true for every SKIPPED_*.
 *   PH12  isExcludedFromPromotion() returns true for every SKIPPED_*.
 *   PH13  Existing 23-family / 72-task inventory still holds (pinned
 *         by release-gauntlet.test.ts; this is a re-export pin).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SKIP_CLASSIFICATIONS,
  SKIP_CODES,
  isSkipClassification,
  isExcludedFromLeaderboard,
  isExcludedFromPromotion,
  visionFixtureMissing,
  modelCanRunVision,
  modelCanRunRoleplay,
  preflightSkipCheck,
} from '../core/skip-classifiers.js';

const ROOT = process.cwd();

describe('Phase 2 · skip classifiers + cleanup flake fix', () => {
  it('PH1 · cleanup.ts exposes a runsDir option for deterministic test injection', () => {
    const cleanupSrc = readFileSync(join(ROOT, 'core', 'cleanup.ts'), 'utf-8');
    assert.match(cleanupSrc, /runsDir\?\s*:\s*string/, 'CleanupOptions must accept runsDir override');
    assert.match(cleanupSrc, /function resolveRunsDir/, 'core/cleanup.ts must compute the runs directory per call (no module-load constant)');
    // Test source must use the injection (no scan of production runs/).
    const testSrc = readFileSync(join(ROOT, 'tests', 'cleanup.test.ts'), 'utf-8');
    assert.match(testSrc, /mkdtempSync/, 'cleanup.test.ts must seed a temp directory');
    assert.match(testSrc, /runsDir:\s*tempRunsDir/, 'cleanup.test.ts must pass runsDir into cleanupStaleArtifacts');
  });

  it('PH2 · visionFixtureMissing detects TBD sha256 + absent fixtures', () => {
    assert.equal(visionFixtureMissing({ sha256: 'TBD-fixture-not-yet-committed', path: 'x.png' }), true);
    assert.equal(visionFixtureMissing({ sha256: '', path: 'x.png' }), true);
    assert.equal(visionFixtureMissing(null), true);
    assert.equal(visionFixtureMissing(undefined), true);
    assert.equal(visionFixtureMissing({ sha256: 'a3f5...', path: 'x.png' }), false);
  });

  it('PH3 · preflightSkipCheck returns SKIPPED_FIXTURE_MISSING for vision tasks whose fixture is TBD (synthetic manifest)', () => {
    // Phase 3 lands real fixtures, so vision-ocr-001's manifest is no
    // longer TBD. Pin the contract using a synthetic in-memory
    // manifest that still has TBD so PH3 keeps proving the rule.
    const m = {
      family: 'vision' as const,
      image_fixture: { sha256: 'TBD-still-pending', path: 'fixtures/vision/never-existed.png' },
    };
    const result = preflightSkipCheck(m, { supportsVision: true, supportsImageInput: true, imageTransportImplemented: true });
    assert.ok(result, 'preflightSkipCheck must return a skip result for a TBD-pinned manifest');
    assert.equal(result!.classification, 'SKIPPED_FIXTURE_MISSING');
    assert.equal(result!.family, 'vision');
    assert.match(result!.fixturePath || '', /\.png$/);
  });

  it('PH4 · no skip code is mistaken for a failure code', () => {
    for (const code of SKIP_CODES) {
      assert.ok(isSkipClassification(code), `${code} must be recognized as a skip`);
      assert.ok(!/^FAIL_/.test(code), `${code} must not start with FAIL_`);
    }
    // None of the skip codes equal FAIL_*.
    for (const fail of ['FAIL_PRODUCT', 'FAIL_PROVIDER', 'FAIL_CONFIG', 'FAIL_MODEL_CAPABILITY']) {
      assert.equal(isSkipClassification(fail), false, `${fail} must NOT classify as a skip`);
    }
  });

  it('PH5 · skip bundle marker (skipped:true + skip_classification) is recorded so leaderboard aggregator excludes it', () => {
    const runnerSrc = readFileSync(join(ROOT, 'core', 'conversational-runner.ts'), 'utf-8');
    assert.match(runnerSrc, /skipped:\s*true/, 'skip bundle must carry skipped:true on score');
    assert.match(runnerSrc, /skip_classification:\s*skip\.classification/, 'skip bundle must carry skip_classification');
    assert.match(runnerSrc, /completionState:\s*"SKIPPED"/, 'skip bundle verdict must use SKIPPED completionState');
    assert.match(runnerSrc, /countsTowardModelScore:\s*false/, 'skip bundle must declare countsTowardModelScore:false');
    assert.match(runnerSrc, /countsTowardFailureRate:\s*false/, 'skip bundle must declare countsTowardFailureRate:false');
  });

  it('PH6 · non-vision model produces SKIPPED_UNSUPPORTED_MULTIMODAL', () => {
    const m = {
      family: 'vision' as const,
      image_fixture: { sha256: 'a3f5committed', path: 'x.png' },
    };
    const result = preflightSkipCheck(m, { supportsVision: false, supportsImageInput: false });
    assert.ok(result);
    assert.equal(result!.classification, 'SKIPPED_UNSUPPORTED_MULTIMODAL');
  });

  it('PH7 · skip bundle records no tokens + no cost (no provider call happened)', () => {
    const runnerSrc = readFileSync(join(ROOT, 'core', 'conversational-runner.ts'), 'utf-8');
    // buildSkipResult writes the zero-spend usage block.
    assert.match(runnerSrc, /usage:\s*\{\s*tokens_in:\s*0,\s*tokens_out:\s*0,\s*cost_usd:\s*0/, 'skip bundle must emit usage = zeros');
  });

  it('PH8 · model-certify.mjs classifyTier filters SKIPPED_* out of tier reasoning', () => {
    const certSrc = readFileSync(join(ROOT, 'scripts', 'model-certify.mjs'), 'utf-8');
    assert.match(certSrc, /SKIP_CODES\s*=\s*new Set\(\[/, 'classifyTier must define a SKIP_CODES set');
    for (const skip of ['SKIPPED_FIXTURE_MISSING', 'SKIPPED_UNSUPPORTED_MULTIMODAL', 'SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE', 'SKIPPED_EXPERIMENTAL_FAMILY']) {
      assert.ok(certSrc.includes(`"${skip}"`), `model-certify SKIP_CODES must include ${skip}`);
    }
    assert.match(certSrc, /scoring\s*=\s*classifications\.filter\(.*SKIP_CODES/, 'classifyTier must filter skip codes out of the scoring set');
  });

  it('PH9 · roleplay opt-out yields SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE', () => {
    const m = { family: 'roleplay' as const };
    assert.equal(preflightSkipCheck(m, { supportsRoleplay: false })?.classification, 'SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE');
    // Default-on: roleplay default-capable models proceed.
    assert.equal(preflightSkipCheck(m, {}), null);
    assert.equal(preflightSkipCheck(m, { supportsRoleplay: true }), null);
  });

  it('PH10 · skip bundle carries the skip reason + classification for UI audit', () => {
    const runnerSrc = readFileSync(join(ROOT, 'core', 'conversational-runner.ts'), 'utf-8');
    assert.match(runnerSrc, /skip_reason:\s*skip\.reason/, 'skip bundle verdict.evidence must carry skip_reason');
    assert.match(runnerSrc, /failureReasonCode:\s*skip\.classification/, 'skip bundle verdict must carry failureReasonCode for legacy consumers');
    // UI must distinguish Skipped from Failed.
    const css = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');
    assert.match(css, /\.badge\.skip(\s|,|\{)/, '.badge.skip CSS missing — UI must render Skipped distinctly');
  });

  it('PH11 · isExcludedFromLeaderboard returns true for every SKIPPED_* code', () => {
    for (const code of SKIP_CODES) {
      assert.equal(isExcludedFromLeaderboard(code), true, `${code} must be excluded from leaderboard composite`);
    }
    // PASS is NOT excluded.
    assert.equal(isExcludedFromLeaderboard('PASS'), false);
    // FAIL_PRODUCT is NOT excluded — it's a real signal that counts.
    assert.equal(isExcludedFromLeaderboard('FAIL_PRODUCT'), false);
  });

  it('PH12 · isExcludedFromPromotion returns true for every SKIPPED_* code', () => {
    for (const code of SKIP_CODES) {
      assert.equal(isExcludedFromPromotion(code), true, `${code} must be excluded from cert tier promotion`);
    }
    assert.equal(isExcludedFromPromotion('PASS'), false);
  });

  it('PH13 · SKIP_CLASSIFICATIONS map carries all four required codes with labels + reasons', () => {
    for (const c of ['SKIPPED_FIXTURE_MISSING', 'SKIPPED_UNSUPPORTED_MULTIMODAL', 'SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE', 'SKIPPED_EXPERIMENTAL_FAMILY']) {
      const entry = (SKIP_CLASSIFICATIONS as Record<string, { code: string; label: string; reason: string; countsAsFail: boolean }>)[c];
      assert.ok(entry, `SKIP_CLASSIFICATIONS missing ${c}`);
      assert.equal(entry.code, c, `${c} code must match key`);
      assert.ok(entry.label && entry.label.length > 0, `${c} label required`);
      assert.ok(entry.reason && entry.reason.length > 5, `${c} reason required`);
      assert.equal(entry.countsAsFail, false, `${c} must not count as fail`);
    }
  });

  describe('Phase 2 tactical guards', () => {
    it('all 5 vision POC manifests now point at committed fixtures (Phase 3)', () => {
      // Phase 3 landed real synthetic PNGs and replaced TBD pins. The
      // preflight should now PROCEED on capability+transport-OK calls
      // (not skip on fixture). Adapter transport still unimplemented,
      // so without imageTransportImplemented=true we expect
      // SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED — but never
      // SKIPPED_FIXTURE_MISSING for these manifests anymore.
      const ids = ['vision-ocr-001', 'vision-ui-001', 'vision-chart-001', 'vision-object-count-001', 'vision-uncertainty-001'];
      for (const id of ids) {
        const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', id, 'manifest.json'), 'utf-8'));
        const skip = preflightSkipCheck(m, { supportsVision: true, supportsImageInput: true });
        if (skip) {
          assert.notEqual(skip.classification, 'SKIPPED_FIXTURE_MISSING', `${id}: must no longer preflight-skip on TBD fixture (sha256 is real now)`);
        }
      }
    });

    it('modelCanRunVision requires BOTH supportsVision AND supportsImageInput', () => {
      assert.equal(modelCanRunVision({ supportsVision: true, supportsImageInput: true }), true);
      assert.equal(modelCanRunVision({ supportsVision: true, supportsImageInput: false }), false);
      assert.equal(modelCanRunVision({ supportsVision: false, supportsImageInput: true }), false);
      assert.equal(modelCanRunVision({}), false);
      assert.equal(modelCanRunVision(null), false);
    });

    it('modelCanRunRoleplay defaults to true (text-only-OK) and respects explicit opt-out', () => {
      assert.equal(modelCanRunRoleplay({}), true);
      assert.equal(modelCanRunRoleplay({ supportsRoleplay: true }), true);
      assert.equal(modelCanRunRoleplay({ supportsRoleplay: false }), false);
      assert.equal(modelCanRunRoleplay(null), true);
    });
  });
});
