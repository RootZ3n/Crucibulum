/**
 * Crucible — Roleplay/Vision Phase 4 pins
 *
 *   P1  · focused-run inspector renders skip cards distinctly from fail cards
 *   P2  · skip cards say "Skipped, not failed"
 *   P3  · skip cards declare affectsLeaderboard:NO + affectsCertification:NO
 *   P4  · skip cards declare provider-called:NO for preflight skips
 *   P5  · fixture path metadata appears in skip cards
 *   P6  · capability snapshot appears in unsupported-multimodal skip cards (CSS hook + renderer)
 *   P7  · OpenRouter adapter forwards content as array (image_url parts) verbatim
 *   P8  · fixture hash validation runs BEFORE image payload construction
 *   P9  · unsupported multimodal model does NOT reach adapter.chat (gated by preflight)
 *   P10 · SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED distinct from FAIL_PROVIDER
 *   P11 · scripts/vision-smoke.mjs runs only the intended 2-test set by default
 *   P12 · vision-smoke report declares affectsLeaderboard:false + affectsCertification:false
 *   P13 · ConversationalFamily union now includes "roleplay" and "vision"
 *   P14 · release-gauntlet inventory still 23 families / 72 tasks / 47 conversational
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  preflightSkipCheck,
  verifyFixtureOnDisk,
  type FixtureFsHandle,
} from '../core/skip-classifiers.js';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');
const SMOKE_SCRIPT = readFileSync(join(ROOT, 'scripts', 'vision-smoke.mjs'), 'utf-8');

const REPO_FS: FixtureFsHandle = {
  exists: (p: string) => existsSync(join(ROOT, p)),
  read: (p: string) => readFileSync(join(ROOT, p)),
  sha256Hex: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};

describe('Phase 4 · skip-card rendering + image transport', () => {
  it('P1 · renderSkipCards exists and mounts above LAYER C', () => {
    assert.ok(HTML.includes('function renderSkipCards'), 'renderSkipCards function missing');
    // Mounted inside renderFocusedRun, above the Test Review Explorer.
    const focusedStart = HTML.indexOf('function renderFocusedRun(tabKey)');
    assert.ok(focusedStart > 0, 'renderFocusedRun not found');
    const focused = HTML.slice(focusedStart, focusedStart + 12000);
    assert.ok(focused.includes('renderSkipCards(result)'), 'renderFocusedRun must call renderSkipCards(result)');
    const skipIdx = focused.indexOf('renderSkipCards(result)');
    const layerCIdx = focused.indexOf('LAYER C');
    assert.ok(skipIdx > 0 && layerCIdx > 0 && skipIdx < layerCIdx, 'renderSkipCards must mount BEFORE LAYER C');
    // CSS for the skip card is defined.
    assert.ok(CSS.includes('.skip-card'), '.skip-card CSS missing');
  });

  it('P2 · skip card explicitly says "Skipped, not failed"', () => {
    const fn = HTML.match(/function renderSkipCards[\s\S]*?\n\}/);
    assert.ok(fn, 'renderSkipCards body not found');
    assert.match(fn![0], /Skipped, not failed/, 'skip card must include the "Skipped, not failed" phrase');
    assert.match(fn![0], /SKIPPED · NOT FAILED/, 'skip card eyebrow must show SKIPPED · NOT FAILED');
  });

  it('P3 · skip card declares affectsLeaderboard:NO + affectsCertification:NO', () => {
    const fn = HTML.match(/function renderSkipCards[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn![0], /Affects leaderboard/, 'skip card must show "Affects leaderboard" row');
    assert.match(fn![0], /Affects certification/, 'skip card must show "Affects certification" row');
    // Both should render as a "NO" skip badge.
    const noBadges = (fn![0].match(/badge skip">NO</g) || []).length;
    assert.ok(noBadges >= 3, `skip card should render at least 3 NO badges (provider-called, leaderboard, cert); got ${noBadges}`);
  });

  it('P4 · skip card declares provider-called:NO for preflight skips', () => {
    const fn = HTML.match(/function renderSkipCards[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn![0], /Provider called/, 'skip card must show "Provider called" row');
    assert.match(fn![0], /Tokens spent/, 'skip card must show "Tokens spent" = 0 in 0 out');
    assert.match(fn![0], /\$0\.0000/, 'skip card must show cost $0.0000');
  });

  it('P5 · skip card surfaces fixture path when present', () => {
    const fn = HTML.match(/function renderSkipCards[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn![0], /fixturePath/, 'skip card must read fixturePath from verdict.evidence');
    assert.match(fn![0], /Fixture path/, 'skip card must label the fixture path row');
  });

  it('P6 · skip card surfaces capability snapshot for unsupported-multimodal skips', () => {
    const fn = HTML.match(/function renderSkipCards[\s\S]*?\n\}/);
    assert.ok(fn);
    assert.match(fn![0], /capability_required/, 'skip card must read capability_required from verdict.evidence');
    assert.match(fn![0], /Required capability/, 'skip card must label the capability row');
  });

  it('P7 · OpenRouter adapter signature accepts non-string content (image_url parts)', () => {
    const adapter = readFileSync(join(ROOT, 'adapters', 'openrouter.ts'), 'utf-8');
    // Both private callAPI and the exported buildOpenRouterChatBody
    // accept content as `unknown` — OpenAI/OpenRouter accept both
    // string and content-part arrays per the chat schema.
    assert.match(adapter, /messages:\s*Array<\{\s*role:\s*string;\s*content:\s*unknown\s*\}>/, 'OpenRouter callAPI must accept content:unknown');
    // The exported builder accepts the widened shape too.
    assert.match(adapter, /export function buildOpenRouterChatBody/, 'builder must be exported');
  });

  it('P8 · fixture hash validation runs BEFORE image payload construction', () => {
    // The conversational runner calls preflightSkipCheck (which hashes
    // the fixture via FixtureFsHandle) BEFORE the message-push block
    // that constructs image_url content. Verify source ordering.
    const runner = readFileSync(join(ROOT, 'core', 'conversational-runner.ts'), 'utf-8');
    const preflightIdx = runner.indexOf('preflightSkipCheck(');
    const imageBuildIdx = runner.indexOf('type: "image_url"');
    assert.ok(preflightIdx > 0, 'preflightSkipCheck call missing from runner');
    assert.ok(imageBuildIdx > 0, 'image_url content construction missing from runner');
    assert.ok(preflightIdx < imageBuildIdx, 'preflight must run BEFORE image payload construction');
  });

  it('P9 · unsupported multimodal model does NOT reach adapter.chat (gated by preflight)', () => {
    // Pure-function check: a vision manifest + a non-vision model
    // capability snapshot must produce a SKIPPED_UNSUPPORTED_MULTIMODAL
    // result, NEVER null.
    const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', 'vision-ocr-001', 'manifest.json'), 'utf-8'));
    const skip = preflightSkipCheck(m, { supportsVision: false, supportsImageInput: false, imageTransportImplemented: false }, { fs: REPO_FS });
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_UNSUPPORTED_MULTIMODAL');
  });

  it('P10 · SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED is distinct from FAIL_PROVIDER', () => {
    // Capability OK + transport off → SKIP, not FAIL_PROVIDER.
    const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', 'vision-ocr-001', 'manifest.json'), 'utf-8'));
    const skip = preflightSkipCheck(m, { supportsVision: true, supportsImageInput: true, imageTransportImplemented: false }, { fs: REPO_FS });
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED');
    assert.notEqual(skip!.classification, 'FAIL_PROVIDER');
  });

  it('P11 · scripts/vision-smoke.mjs preserves Phase-4 2-test set under --smoke-minimal', () => {
    // Phase 6: default expanded to all 5 POC tests. The Phase-4 minimal set
    // is preserved verbatim under --smoke-minimal for backcompat.
    assert.match(SMOKE_SCRIPT, /const MINIMAL_TESTS\s*=\s*\["vision-ocr-001",\s*"vision-object-count-001"\]/, '--smoke-minimal must still resolve to the original 2-test POC set');
    assert.match(SMOKE_SCRIPT, /TESTS\s*=\s*\[\.\.\.MINIMAL_TESTS\]/, '--smoke-minimal branch must spread MINIMAL_TESTS into TESTS');
  });

  it('P12 · vision-smoke report declares experimental + non-affecting status', () => {
    assert.match(SMOKE_SCRIPT, /affectsLeaderboard:\s*false/, 'vision-smoke json must record affectsLeaderboard:false');
    assert.match(SMOKE_SCRIPT, /affectsCertification:\s*false/, 'vision-smoke json must record affectsCertification:false');
    assert.match(SMOKE_SCRIPT, /experimental:\s*true/, 'vision-smoke json must record experimental:true');
  });

  it('P13 · ConversationalFamily union now includes roleplay + vision', () => {
    const base = readFileSync(join(ROOT, 'adapters', 'base.ts'), 'utf-8');
    assert.match(base, /\|\s*"roleplay"/, 'ConversationalFamily must include "roleplay"');
    assert.match(base, /\|\s*"vision"/, 'ConversationalFamily must include "vision"');
  });

  it('P14 · release-gauntlet --dry-run-inventory still reports 23 families / 72 tasks / 47 conversational', () => {
    const out = execFileSync(process.execPath, ['scripts/release-gauntlet.mjs', '--dry-run-inventory'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    assert.match(out, /families:\s+23/);
    assert.match(out, /tasks total:\s+72/);
    assert.match(out, /conversational:\s+47/);
  });

  describe('Phase 4 tactical guards', () => {
    it('skip-card CSS uses dashed border + grey ink (visually distinct from fail-red)', () => {
      const card = CSS.match(/\.skip-card\{[\s\S]*?\n\}/);
      assert.ok(card, '.skip-card CSS missing');
      assert.match(card![0], /border:\s*1px dashed/, '.skip-card must use dashed border');
      assert.ok(!/var\(--red\)/.test(card![0]), '.skip-card must NOT use red');
    });

    it('verifyFixtureOnDisk returns OK for all 5 committed POC fixtures', () => {
      const ids = ['vision-ocr-001', 'vision-ui-001', 'vision-chart-001', 'vision-object-count-001', 'vision-uncertainty-001'];
      for (const id of ids) {
        const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', id, 'manifest.json'), 'utf-8'));
        const r = verifyFixtureOnDisk(REPO_FS, m.image_fixture);
        assert.equal(r.state, 'OK', `${id}: fixture must verify as OK on disk`);
      }
    });

    it('preflight proceeds (returns null) when all three gates are green', () => {
      const m = JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', 'vision-ocr-001', 'manifest.json'), 'utf-8'));
      const skip = preflightSkipCheck(m, { supportsVision: true, supportsImageInput: true, imageTransportImplemented: true }, { fs: REPO_FS });
      assert.equal(skip, null, 'preflight must NOT skip when fixture + capability + transport all green');
    });
  });
});
