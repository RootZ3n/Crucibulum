/**
 * Crucible — model certification registry pins
 *
 * The 2026-05-25 OpenRouter campaign expanded the registry from 3 to
 * 8 entries across 5 tiers. This file pins:
 *
 *   1. MODEL_CERTIFICATION exists with the 5 documented tiers.
 *   2. Every operator-priority model has a tier (no UNKNOWN gaps for
 *      visible models the operator depends on).
 *   3. certified-models.json uses provider+modelId (not display name).
 *   4. UI label for PROVIDER_TESTED is distinct from EXPERIMENTAL.
 *   5. EXPERIMENTAL warning still appears (harsh copy).
 *   6. The release-certification banner buckets selected models by tier.
 *   7. Mock/harness models are NOT release-certified.
 *   8. Each model-certification report includes a commit hash + dirty-tree flag.
 *   9. classifyTier in scripts/model-certify.mjs blocks promotion on
 *      FAIL_PRODUCT (not just on any non-PASS).
 *  10. Cost cap is enforced — script requires --max-cost-usd for cloud providers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const SCRIPT = readFileSync(join(ROOT, 'scripts', 'model-certify.mjs'), 'utf-8');
const REGISTRY_PATH = join(ROOT, 'reports', 'model-certification', 'certified-models.json');

describe('Crucible model certification', () => {
  it('C1 · MODEL_CERTIFICATION exists with all 5 tiers + UNKNOWN fallback', () => {
    assert.ok(HTML.includes('const MODEL_CERTIFICATION'), 'missing MODEL_CERTIFICATION constant in ui/index.html');
    for (const t of ['RELEASE_CERTIFIED', 'PROVIDER_TESTED', 'EXPERIMENTAL', 'BLOCKED_CONFIG', 'UNSUPPORTED_CAPABILITY', 'UNKNOWN']) {
      assert.ok(new RegExp(`${t}\\s*:\\s*\\{[^}]*label`).test(HTML), `MODEL_CERTIFICATION.tiers.${t} missing label`);
    }
  });

  it('C2 · every operator-priority OpenRouter model has a registered tier', () => {
    // Operator priority list from the 2026-05-25 commit message:
    // deepseek-v4 (flash + pro) and all mimo variants.
    const required = [
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-flash',
      'xiaomi/mimo-v2.5',
      'xiaomi/mimo-v2.5-pro',
      'xiaomi/mimo-v2-flash',
      'xiaomi/mimo-v2-omni',
    ];
    for (const id of required) {
      const re = new RegExp(`providerId:'openrouter'[^}]*modelId:'${id.replace(/[.+*?]/g, '\\$&')}'[^}]*tier:'(RELEASE_CERTIFIED|PROVIDER_TESTED|EXPERIMENTAL|BLOCKED_CONFIG|UNSUPPORTED_CAPABILITY)'`);
      assert.ok(re.test(HTML), `MODEL_CERTIFICATION missing tier for openrouter/${id}`);
    }
  });

  it('C3 · certified-models.json uses provider + modelId (not display name alone)', () => {
    assert.ok(existsSync(REGISTRY_PATH), `${REGISTRY_PATH} missing`);
    const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    assert.ok(Array.isArray(reg.models) && reg.models.length > 0, 'registry has no models');
    for (const m of reg.models) {
      assert.ok(typeof m.provider === 'string' && m.provider.length > 0, `model entry missing provider: ${JSON.stringify(m)}`);
      assert.ok(typeof m.modelId === 'string' && m.modelId.length > 0, `model entry missing modelId: ${JSON.stringify(m)}`);
      assert.ok(typeof m.tier === 'string', `model entry missing tier: ${JSON.stringify(m)}`);
    }
  });

  it('C4 · PROVIDER_TESTED UI label is distinct (and softer) than EXPERIMENTAL', () => {
    const tierBlock = HTML.match(/PROVIDER_TESTED\s*:\s*\{[^}]*\}/);
    assert.ok(tierBlock, 'PROVIDER_TESTED tier block not found');
    assert.ok(/label:\s*'Provider-tested'/.test(tierBlock![0]), 'PROVIDER_TESTED must use the "Provider-tested" label');
    // Warning must NOT include "Uncertified target" — that's the
    // harsh EXPERIMENTAL warning.
    assert.ok(!/warning:\s*'[^']*Uncertified target/.test(tierBlock![0]), 'PROVIDER_TESTED warning must NOT reuse the harsh "Uncertified target" copy');
  });

  it('C5 · EXPERIMENTAL warning still appears for unproven models', () => {
    const tierBlock = HTML.match(/EXPERIMENTAL\s*:\s*\{[^}]*\}/);
    assert.ok(tierBlock, 'EXPERIMENTAL tier block not found');
    assert.ok(/warning:\s*'[^']*Uncertified target/.test(tierBlock![0]), 'EXPERIMENTAL must keep the "Uncertified target" warning');
  });

  it('C6 · release-cert banner buckets selected models by tier', () => {
    // renderReleaseCertificationBanner must read modelCertificationTier
    // and split selected ids into RELEASE_CERTIFIED / PROVIDER_TESTED /
    // EXPERIMENTAL.
    assert.ok(/renderReleaseCertificationBanner[\s\S]{0,3000}modelCertificationTier/.test(HTML), 'release-cert banner must call modelCertificationTier');
    assert.ok(/renderReleaseCertificationBanner[\s\S]{0,3000}provider-tested/i.test(HTML), 'release-cert banner must surface a provider-tested bucket');
  });

  it('C7 · mock/harness models are NOT in the release-certified tier', () => {
    const reg = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    for (const m of reg.models) {
      const id = (m.modelId || '').toLowerCase();
      const isMock = id.includes('mock') || id.includes('harness') || id.includes('stub') || id.includes('fake');
      if (isMock) {
        assert.notEqual(m.tier, 'RELEASE_CERTIFIED', `mock model ${m.provider}/${m.modelId} must not be RELEASE_CERTIFIED`);
      }
    }
  });

  it('C8 · each per-model report includes commit hash + dirtyTree flag', () => {
    const dir = join(ROOT, 'reports', 'model-certification', 'openrouter');
    if (!existsSync(dir)) {
      // No reports yet — registry might be empty. Skip silently.
      return;
    }
    const subdirs = readdirSync(dir);
    let checked = 0;
    for (const sub of subdirs) {
      const subdir = join(dir, sub);
      const files = readdirSync(subdir).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const json = JSON.parse(readFileSync(join(subdir, f), 'utf-8'));
        assert.ok(typeof json.commit === 'string' && json.commit.length === 40, `${sub}/${f} missing 40-char commit hash`);
        assert.ok(typeof json.dirtyTree === 'boolean', `${sub}/${f} missing dirtyTree boolean`);
        checked++;
      }
    }
    assert.ok(checked > 0, 'no per-model reports found to validate');
  });

  it('C9 · classifyTier blocks promotion on FAIL_PRODUCT (downgrades to EXPERIMENTAL)', () => {
    assert.ok(/function classifyTier/.test(SCRIPT), 'classifyTier missing from model-certify.mjs');
    // The rule must explicitly check FAIL_PRODUCT and return EXPERIMENTAL.
    assert.ok(/FAIL_PRODUCT[^)]*\)\)\s*return\s*"EXPERIMENTAL"/.test(SCRIPT) || /FAIL_PRODUCT.{0,200}EXPERIMENTAL/.test(SCRIPT), 'classifyTier must return EXPERIMENTAL when any classification is FAIL_PRODUCT');
  });

  it('C10 · cost cap is enforced for cloud providers (script refuses 0 cap)', () => {
    // The wrapper must require --max-cost-usd > 0 for any non-local
    // provider; "ollama" is the only local provider in the registry.
    assert.ok(/cloud provider[^]*?requires --max-cost-usd/.test(SCRIPT) || /cloud provider.+--max-cost-usd/.test(SCRIPT), 'model-certify.mjs must require --max-cost-usd for cloud providers');
    // Validate by spot-checking the runtime guard.
    assert.ok(/isLocal\s*=.*ollama/.test(SCRIPT), 'cost-cap guard must whitelist ollama (local) only');
  });
});
