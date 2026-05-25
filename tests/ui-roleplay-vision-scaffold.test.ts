/**
 * Crucible — Roleplay + Vision capability scaffold pins
 *
 * Phase 8 of the capability-expansion plan. These tests lock in the
 * architecture/schema of the two experimental families so future
 * work (real adapter image transport, judge rubric implementation,
 * fixture commits) can't silently regress the contract.
 *
 * 10 pins (RV1-RV10) plus tactical guards.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');

const ROLEPLAY_TASKS = [
  'roleplay-character-001',
  'roleplay-continuity-001',
  'roleplay-dm-001',
  'roleplay-boundary-001',
  'roleplay-tone-001',
];
const VISION_TASKS = [
  'vision-ocr-001',
  'vision-ui-001',
  'vision-chart-001',
  'vision-object-count-001',
  'vision-uncertainty-001',
];

function loadManifest(family: string, id: string) {
  const p = join(ROOT, 'tasks', family, id, 'manifest.json');
  assert.ok(existsSync(p), `manifest missing: ${p}`);
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('Crucible roleplay + vision capability scaffold', () => {
  it('RV1 · Roleplay family appears in TAB_CONFIG as Experimental', () => {
    assert.ok(HTML.includes("roleplay:{key:'roleplay'"), 'TAB_CONFIG missing roleplay entry');
    assert.ok(/roleplay:\{[^}]*experimental:true/.test(HTML), 'roleplay tab must declare experimental:true');
    assert.ok(/roleplay:\{[^}]*requiresCapability:'supportsRoleplay'/.test(HTML), 'roleplay tab must declare requiresCapability:"supportsRoleplay"');
  });

  it('RV2 · Vision family appears in TAB_CONFIG as Experimental + requires vision capability', () => {
    assert.ok(HTML.includes("vision:{key:'vision'"), 'TAB_CONFIG missing vision entry');
    assert.ok(/vision:\{[^}]*experimental:true/.test(HTML), 'vision tab must declare experimental:true');
    assert.ok(/vision:\{[^}]*requiresCapability:'supportsVision'/.test(HTML), 'vision tab must declare requiresCapability:"supportsVision"');
  });

  it('RV3 · MODEL_CERTIFICATION declares capability flags + adapter image transport map', () => {
    assert.ok(/capabilityDefaults\s*:\s*\{[^}]*supportsVision:false/.test(HTML), 'capabilityDefaults must default supportsVision to false');
    assert.ok(/capabilityDefaults\s*:\s*\{[^}]*supportsRoleplay:true/.test(HTML), 'capabilityDefaults must default supportsRoleplay to true (text-only-OK)');
    assert.ok(/adapterImageTransport\s*:\s*\{/.test(HTML), 'adapterImageTransport map missing');
    for (const p of ['openai', 'anthropic', 'openrouter', 'minimax', 'modelstudio', 'zai', 'ollama']) {
      assert.ok(new RegExp(`adapterImageTransport[\\s\\S]{0,3000}${p}\\s*:`).test(HTML), `adapterImageTransport missing ${p}`);
    }
  });

  it('RV4 · Helper functions modelSupportsVision/Roleplay exist and respect per-model overrides', () => {
    assert.ok(HTML.includes('function modelSupportsVision'), 'missing modelSupportsVision');
    assert.ok(HTML.includes('function modelSupportsRoleplay'), 'missing modelSupportsRoleplay');
    assert.ok(HTML.includes('function modelCapability'), 'missing modelCapability lookup');
    // xiaomi/mimo-v2-omni is the vision-capable model in the registry — pin it.
    assert.ok(/mimo-v2-omni[\s\S]{0,500}supportsVision:true/.test(HTML), 'mimo-v2-omni must declare supportsVision:true (multimodal OpenRouter route)');
  });

  it('RV5 · room card renderer surfaces an EXP badge for experimental families', () => {
    const roomFn = HTML.match(/function renderEvaluationRoomsDeck\(\)[\s\S]*?\n\}\n/);
    assert.ok(roomFn, 'renderEvaluationRoomsDeck not found');
    assert.ok(/tab\.experimental\s*===\s*true/.test(roomFn![0]), 'room renderer must detect tab.experimental === true');
    // The pill literal lives inside a template-literal — match the
    // bare text node.
    assert.ok(/room-pill exp[\s\S]{0,200}EXP/.test(roomFn![0]) || />EXP</.test(roomFn![0]), 'room renderer must render an EXP pill for experimental tabs');
    // CSS for the EXP pill is distinct.
    assert.ok(CSS.includes('.room-pill.exp'), '.room-pill.exp CSS missing');
  });

  it('RV6 · 5 roleplay POC manifests exist with consistent schema', () => {
    for (const id of ROLEPLAY_TASKS) {
      const m = loadManifest('roleplay', id);
      assert.equal(m.family, 'roleplay', `${id}: family must be "roleplay"`);
      assert.equal(m.experimental, true, `${id}: experimental flag must be true`);
      assert.equal(m.quarantine, null, `${id}: quarantine must be null (not yet quarantined; not yet certified)`);
      assert.ok(Array.isArray(m.questions) && m.questions.length >= 3, `${id}: must have at least 3 turns`);
      assert.ok(m.scoring && Array.isArray(m.scoring.rubrics) && m.scoring.rubrics.length > 0, `${id}: must declare scoring.rubrics`);
    }
  });

  it('RV7 · 5 vision POC manifests exist with image_fixture + requires_capability metadata', () => {
    for (const id of VISION_TASKS) {
      const m = loadManifest('vision', id);
      assert.equal(m.family, 'vision', `${id}: family must be "vision"`);
      assert.equal(m.experimental, true, `${id}: experimental flag must be true`);
      assert.ok(Array.isArray(m.requires_capability), `${id}: requires_capability must be a list`);
      assert.ok(m.requires_capability.includes('supportsVision'), `${id}: requires_capability must include supportsVision`);
      assert.ok(m.requires_capability.includes('supportsImageInput'), `${id}: requires_capability must include supportsImageInput`);
      assert.ok(m.image_fixture && typeof m.image_fixture.path === 'string', `${id}: image_fixture.path required`);
      assert.ok('sha256' in m.image_fixture, `${id}: image_fixture.sha256 must be present (TBD placeholder OK pre-commit of bytes)`);
      assert.ok(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(m.image_fixture.mime), `${id}: image_fixture.mime must be a supported type`);
      // License must be declared so we never accidentally commit copyrighted images.
      assert.ok(typeof m.image_fixture.license === 'string' && m.image_fixture.license.length > 0, `${id}: image_fixture.license required`);
    }
  });

  it('RV8 · TASK_FAMILY_LABELS covers roleplay + vision', () => {
    assert.ok(/roleplay\s*:\s*'Roleplay'/.test(HTML), 'TASK_FAMILY_LABELS missing roleplay → Roleplay');
    assert.ok(/vision\s*:\s*'Vision'/.test(HTML), 'TASK_FAMILY_LABELS missing vision → Vision');
  });

  it('RV9 · No vision manifest assumes a model that lacks vision support — gating is capability-driven', () => {
    // Vision manifests must NOT name a specific model in their prompt
    // (so the runner is forced to consult capability metadata, not
    // pretend "GPT-5.4 vision route" is universal).
    for (const id of VISION_TASKS) {
      const m = loadManifest('vision', id);
      const promptish = JSON.stringify(m);
      assert.ok(!/(gpt-5\.4|claude-opus-4|deepseek|mimo|qwen|claude-haiku)/i.test(promptish), `${id}: manifest must NOT hard-code a model id — capability flags drive eligibility`);
    }
  });

  it('RV10 · Suite design docs exist with required sections', () => {
    const roleplayDoc = readFileSync(join(ROOT, 'docs', 'ROLEPLAY_TEST_SUITE.md'), 'utf-8');
    const visionDoc = readFileSync(join(ROOT, 'docs', 'MULTIMODAL_VISION_SUITE.md'), 'utf-8');
    for (const section of ['Purpose', 'What this suite measures', 'What this suite does NOT measure', 'Task schema', 'Evidence bundle requirements', 'Failure classifications', 'Certification rules', 'Known risks']) {
      assert.ok(roleplayDoc.includes(section), `ROLEPLAY doc missing section "${section}"`);
      assert.ok(visionDoc.includes(section), `VISION doc missing section "${section}"`);
    }
    assert.ok(roleplayDoc.includes('Experimental scaffold'), 'ROLEPLAY doc must flag Experimental status');
    assert.ok(visionDoc.includes('Experimental scaffold'), 'VISION doc must flag Experimental status');
  });

  describe('tactical guards', () => {
    it('vision manifests now carry real sha256 hashes (Phase 3 landed fixtures)', () => {
      // Phase 3 (commit after 7ccd77c) added synthetic PNG fixtures
      // under fixtures/vision/ and replaced TBD pins with the real
      // sha256 of each generated file. Pin: no TBD remains.
      for (const id of VISION_TASKS) {
        const m = loadManifest('vision', id);
        const s = String(m.image_fixture.sha256 || '');
        assert.ok(!s.startsWith('TBD'), `${id}: fixture sha256 should be a real hash post-Phase-3 (got ${s.slice(0, 10)})`);
        assert.match(s, /^[a-f0-9]{64}$/, `${id}: fixture sha256 should be 64 hex chars`);
      }
    });

    it('roleplay manifests declare per-question rubrics so a single PASS cannot mask a per-turn FAIL_OVER_REFUSAL', () => {
      for (const id of ROLEPLAY_TASKS) {
        const m = loadManifest('roleplay', id);
        const allQuestionsHaveRubrics = m.questions.every((q: { rubrics?: string[] }) =>
          Array.isArray(q.rubrics) && q.rubrics.length > 0,
        );
        assert.ok(allQuestionsHaveRubrics, `${id}: every question must declare its own rubrics list`);
      }
    });

    it('roleplay-boundary-001 specifically pins the over-refusal hazard', () => {
      const m = loadManifest('roleplay', 'roleplay-boundary-001');
      const benign = m.questions.find((q: { id: string }) => q.id === 'RP4-Q1');
      assert.ok(benign, 'RP4-Q1 must exist');
      assert.ok(/FAIL_OVER_REFUSAL/.test(JSON.stringify(benign)), 'RP4-Q1 expectation must explicitly call out FAIL_OVER_REFUSAL as the failure mode for refusing the benign turn');
    });
  });
});
