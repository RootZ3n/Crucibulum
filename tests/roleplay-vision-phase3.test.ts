/**
 * Crucible — Roleplay/Vision Phase 3 pins
 *
 * Adds 14 assertions for the synthetic vision fixture set:
 *
 *   V1  · all 5 fixture files exist on disk
 *   V2  · all 5 fixture files match the manifest-pinned sha256
 *   V3  · no vision manifest still uses a TBD sha256
 *   V4  · all 5 fixtures are <= 50 KB and image/png
 *   V5  · a synthetic manifest with TBD still produces SKIPPED_FIXTURE_MISSING
 *         (the rule still works for not-yet-committed fixtures)
 *   V6  · a real manifest with a mutated sha256 produces SKIPPED_FIXTURE_HASH_MISMATCH
 *         (integrity distinct from missing)
 *   V7  · non-vision model with valid fixture produces SKIPPED_UNSUPPORTED_MULTIMODAL
 *   V8  · vision-capable model + fixture-present + no image transport
 *         produces SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED
 *   V9  · vision-capable model + fixture + transport=true: preflight proceeds (null)
 *   V10 · SKIPPED_FIXTURE_HASH_MISMATCH is in the SKIP_CLASSIFICATIONS map
 *   V11 · SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED is in the SKIP_CLASSIFICATIONS map
 *   V12 · model-certify SKIP_CODES includes both new codes
 *   V13 · release-gauntlet --dry-run-inventory still reports 23/72/47
 *   V14 · fixture generator script is present, deterministic, and small
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SKIP_CLASSIFICATIONS,
  preflightSkipCheck,
  verifyFixtureOnDisk,
  type FixtureFsHandle,
} from '../core/skip-classifiers.js';

const ROOT = process.cwd();
const VISION_TASK_IDS = [
  'vision-ocr-001',
  'vision-ui-001',
  'vision-chart-001',
  'vision-object-count-001',
  'vision-uncertainty-001',
];

interface VisionManifest {
  family: string;
  image_fixture: { path: string; sha256: string; mime: string };
  requires_capability?: string[];
}

function loadManifest(id: string): VisionManifest {
  return JSON.parse(readFileSync(join(ROOT, 'tasks', 'vision', id, 'manifest.json'), 'utf-8'));
}

function sha256OfFile(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

// A FixtureFsHandle that reads from the repo root. Used by all
// verifyFixtureOnDisk + preflightSkipCheck calls below.
const REPO_FS: FixtureFsHandle = {
  exists: (p: string) => existsSync(join(ROOT, p)),
  read: (p: string) => readFileSync(join(ROOT, p)),
  sha256Hex: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};

describe('Phase 3 · synthetic vision fixtures', () => {
  it('V1 · all 5 vision POC fixture files exist on disk under fixtures/vision/', () => {
    for (const id of VISION_TASK_IDS) {
      const m = loadManifest(id);
      assert.ok(existsSync(join(ROOT, m.image_fixture.path)), `${id}: missing fixture at ${m.image_fixture.path}`);
    }
  });

  it('V2 · every fixture sha256 on disk matches its manifest pin', () => {
    for (const id of VISION_TASK_IDS) {
      const m = loadManifest(id);
      const actual = sha256OfFile(join(ROOT, m.image_fixture.path));
      assert.equal(actual, m.image_fixture.sha256, `${id}: fixture hash drifted from manifest pin (expected ${m.image_fixture.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
    }
  });

  it('V3 · no vision manifest still pins a TBD sha256', () => {
    for (const id of VISION_TASK_IDS) {
      const m = loadManifest(id);
      assert.ok(!m.image_fixture.sha256.startsWith('TBD'), `${id}: sha256 still starts with TBD — Phase 3 must replace it with a real hash`);
      assert.match(m.image_fixture.sha256, /^[a-f0-9]{64}$/, `${id}: sha256 must be 64 hex chars`);
    }
  });

  it('V4 · every fixture is image/png and under 50 KB', () => {
    for (const id of VISION_TASK_IDS) {
      const m = loadManifest(id);
      assert.equal(m.image_fixture.mime, 'image/png', `${id}: mime must be image/png`);
      const stats = statSync(join(ROOT, m.image_fixture.path));
      assert.ok(stats.size > 0, `${id}: fixture file is empty`);
      assert.ok(stats.size <= 50_000, `${id}: fixture file size ${stats.size} bytes exceeds 50 KB cap`);
    }
  });

  it('V5 · synthetic TBD manifest still produces SKIPPED_FIXTURE_MISSING', () => {
    const skip = preflightSkipCheck(
      { family: 'vision', image_fixture: { sha256: 'TBD-not-yet', path: 'fixtures/vision/nope.png' } },
      { supportsVision: true, supportsImageInput: true, imageTransportImplemented: true },
      { fs: REPO_FS },
    );
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_FIXTURE_MISSING');
  });

  it('V6 · fixture exists but sha256 mutated → SKIPPED_FIXTURE_HASH_MISMATCH (integrity distinct from missing)', () => {
    const ocr = loadManifest('vision-ocr-001');
    const mutated = {
      family: 'vision',
      image_fixture: {
        path: ocr.image_fixture.path,
        sha256: 'f'.repeat(64),  // valid-shape sha but won't match
        mime: ocr.image_fixture.mime,
      },
    };
    const skip = preflightSkipCheck(
      mutated,
      { supportsVision: true, supportsImageInput: true, imageTransportImplemented: true },
      { fs: REPO_FS },
    );
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_FIXTURE_HASH_MISMATCH');
    assert.equal(skip!.expectedSha256, 'f'.repeat(64));
    assert.match(String(skip!.actualSha256 || ''), /^[a-f0-9]{64}$/);
  });

  it('V7 · non-vision model + valid fixture still produces SKIPPED_UNSUPPORTED_MULTIMODAL', () => {
    const ocr = loadManifest('vision-ocr-001');
    const skip = preflightSkipCheck(
      ocr,
      { supportsVision: false, supportsImageInput: false, imageTransportImplemented: false },
      { fs: REPO_FS },
    );
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_UNSUPPORTED_MULTIMODAL');
  });

  it('V8 · vision-capable model + fixture present + transport NOT implemented → SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED', () => {
    const ocr = loadManifest('vision-ocr-001');
    const skip = preflightSkipCheck(
      ocr,
      { supportsVision: true, supportsImageInput: true, imageTransportImplemented: false },
      { fs: REPO_FS },
    );
    assert.ok(skip);
    assert.equal(skip!.classification, 'SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED');
  });

  it('V9 · vision-capable model + fixture present + transport implemented → preflight proceeds (null)', () => {
    const ocr = loadManifest('vision-ocr-001');
    const skip = preflightSkipCheck(
      ocr,
      { supportsVision: true, supportsImageInput: true, imageTransportImplemented: true },
      { fs: REPO_FS },
    );
    assert.equal(skip, null, 'preflight must NOT skip when fixture + capability + transport all green');
  });

  it('V10 · SKIPPED_FIXTURE_HASH_MISMATCH is registered + zero-fail/promotion impact', () => {
    const entry = (SKIP_CLASSIFICATIONS as Record<string, { countsAsFail: boolean; affectsLeaderboard: boolean }>)['SKIPPED_FIXTURE_HASH_MISMATCH'];
    assert.ok(entry, 'SKIP_CLASSIFICATIONS must register SKIPPED_FIXTURE_HASH_MISMATCH');
    assert.equal(entry.countsAsFail, false);
    assert.equal(entry.affectsLeaderboard, false);
  });

  it('V11 · SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED is registered + zero-fail/promotion impact', () => {
    const entry = (SKIP_CLASSIFICATIONS as Record<string, { countsAsFail: boolean; affectsLeaderboard: boolean }>)['SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED'];
    assert.ok(entry, 'SKIP_CLASSIFICATIONS must register SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED');
    assert.equal(entry.countsAsFail, false);
    assert.equal(entry.affectsLeaderboard, false);
  });

  it('V12 · model-certify SKIP_CODES includes both new Phase 3 codes', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'model-certify.mjs'), 'utf-8');
    assert.match(src, /"SKIPPED_FIXTURE_HASH_MISMATCH"/, 'classifyTier SKIP_CODES must include SKIPPED_FIXTURE_HASH_MISMATCH');
    assert.match(src, /"SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED"/, 'classifyTier SKIP_CODES must include SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED');
  });

  it('V13 · release-gauntlet --dry-run-inventory still reports 23 families / 77 tasks / 52 conversational (post Roleplay Phase 2)', () => {
    // Updated 2026-05-26 (Roleplay Phase 2): roleplay family grew from
    // 5 → 10 tasks (added drift-001 / refusal-001 / continuity-002 /
    // contradiction-001 / persona-break-001). Family count unchanged.
    const out = execFileSync(process.execPath, ['scripts/release-gauntlet.mjs', '--dry-run-inventory'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    // Phase 14 / Roadmap C bumped tasks 77 → 87 + conversational
    // 52 → 62 (Vision suite expansion 5 → 15). Families unchanged.
    assert.match(out, /families:\s+23/);
    assert.match(out, /tasks total:\s+87/);
    assert.match(out, /conversational:\s+62/);
  });

  it('V14 · fixture generator script exists, is executable, and deterministic on re-run', () => {
    const script = join(ROOT, 'scripts', 'generate-vision-fixtures.py');
    assert.ok(existsSync(script), 'scripts/generate-vision-fixtures.py must exist');
    // Re-run and verify all 5 hashes still match the manifest pins.
    // (If the generator drifted, the new bytes would produce different
    //  sha256 and V2 would fail; here we re-prove the round-trip.)
    execFileSync('python3', [script], { cwd: ROOT, encoding: 'utf-8', timeout: 30_000 });
    for (const id of VISION_TASK_IDS) {
      const m = loadManifest(id);
      const actual = sha256OfFile(join(ROOT, m.image_fixture.path));
      assert.equal(actual, m.image_fixture.sha256, `${id}: re-generated fixture hash drifted — generator is no longer deterministic`);
    }
  });

  describe('Phase 3 tactical guards', () => {
    it('verifyFixtureOnDisk distinguishes MISSING_FILE from HASH_MISMATCH for the operator', () => {
      const missing = verifyFixtureOnDisk(REPO_FS, { path: 'fixtures/vision/never-existed.png', sha256: 'f'.repeat(64) });
      assert.equal(missing.state, 'MISSING_FILE');
      const ocr = loadManifest('vision-ocr-001');
      const good = verifyFixtureOnDisk(REPO_FS, ocr.image_fixture);
      assert.equal(good.state, 'OK');
      const mutated = verifyFixtureOnDisk(REPO_FS, { path: ocr.image_fixture.path, sha256: '0'.repeat(64) });
      assert.equal(mutated.state, 'HASH_MISMATCH');
    });

    it('TBD sha256 in manifest takes precedence over disk verification', () => {
      // Even if the file exists, a TBD pin means the operator hasn't
      // approved the bytes yet — must skip as MISSING.
      const ocr = loadManifest('vision-ocr-001');
      const result = verifyFixtureOnDisk(REPO_FS, { path: ocr.image_fixture.path, sha256: 'TBD-still-pending' });
      assert.equal(result.state, 'MISSING_FILE');
    });

    it('Vision tab remains experimental:true in TAB_CONFIG (no accidental promotion via Phase 3)', () => {
      const html = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
      assert.match(html, /vision:\{[^}]*experimental:true/, 'vision tab must stay experimental:true after fixture commit');
      assert.match(html, /roleplay:\{[^}]*experimental:true/, 'roleplay tab must stay experimental:true');
    });
  });
});
