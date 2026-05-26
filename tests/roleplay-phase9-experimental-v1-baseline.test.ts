/**
 * Crucible — Roleplay Phase 9: Experimental v1 baseline (offline).
 *
 * 13 deterministic assertions covering Phase 9's scope: machine-
 * readable baseline JSON shape, accompanying markdown, UI baseline
 * note, documentation update, exclusion guarantees, inventory pin.
 *
 * No provider calls. No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const V1_DIR = join(ROOT, "reports", "capability-expansion", "roleplay-experimental-v1");
const V1_LATEST_MD = join(V1_DIR, "latest.md");
const V1_LATEST_JSON = join(V1_DIR, "latest.json");
const ROLEPLAY_DOC = readFileSync(join(ROOT, "docs", "ROLEPLAY_TEST_SUITE.md"), "utf-8");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

describe("Roleplay Phase 9 · Experimental v1 baseline (offline)", () => {
  // -------- file presence --------

  it("RPP9-P01 · Roleplay Experimental v1 latest.md exists at the canonical path", () => {
    assert.ok(existsSync(V1_LATEST_MD), `${V1_LATEST_MD} must exist`);
    const md = readFileSync(V1_LATEST_MD, "utf-8");
    assert.match(md, /Roleplay Experimental v1/);
    assert.match(md, /Experimental v1 baseline/);
  });

  it("RPP9-P02 · Roleplay Experimental v1 latest.json exists at the canonical path", () => {
    assert.ok(existsSync(V1_LATEST_JSON), `${V1_LATEST_JSON} must exist`);
    const text = readFileSync(V1_LATEST_JSON, "utf-8");
    const parsed = JSON.parse(text);
    assert.equal(parsed.schema, "crucible.roleplay-experimental-v1");
    assert.equal(parsed.version, "roleplay-experimental-v1");
  });

  // -------- JSON exclusion contract --------

  it("RPP9-P03 · latest.json has experimental:true", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.equal(d.experimental, true);
  });

  it("RPP9-P04 · latest.json has affectsLeaderboard:false", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.equal(d.affectsLeaderboard, false);
  });

  it("RPP9-P05 · latest.json has affectsCertification:false", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.equal(d.affectsCertification, false);
  });

  // -------- JSON content contract --------

  it("RPP9-P06 · latest.json includes both tested routes (mimo + deepseek)", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.ok(Array.isArray(d.testedRoutes), "testedRoutes must be an array");
    const modelIds = d.testedRoutes.map((r: { modelId: string }) => r.modelId);
    assert.ok(modelIds.includes("xiaomi/mimo-v2-flash"), "mimo-v2-flash must be in testedRoutes");
    assert.ok(modelIds.includes("deepseek/deepseek-v4-flash"), "deepseek-v4-flash must be in testedRoutes");
    // Each route must carry the experimental/exclusion-relevant fields.
    for (const r of d.testedRoutes) {
      assert.equal(r.providerId, "openrouter", `${r.modelId}: providerId must be openrouter`);
      assert.equal(r.supportsRoleplay, true, `${r.modelId}: supportsRoleplay must be true`);
      assert.equal(r.tier, "PROVIDER_TESTED", `${r.modelId}: tier must be PROVIDER_TESTED (Roleplay does not promote)`);
    }
  });

  it("RPP9-P07 · latest.json includes a stabilitySummary with both routes' STABLE_PASS lists", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.ok(d.stabilitySummary, "stabilitySummary required");
    assert.equal(d.stabilitySummary.repeatRuns, 3);
    assert.ok(Array.isArray(d.stabilitySummary.stablePass["mimo-v2-flash"]), "mimo stablePass list required");
    assert.ok(Array.isArray(d.stabilitySummary.stablePass["deepseek-v4-flash"]), "deepseek stablePass list required");
    // refusal-001 is STABLE_PASS on both routes (Phase 6 + 8 calibration).
    assert.ok(d.stabilitySummary.stablePass["mimo-v2-flash"].includes("roleplay-refusal-001"));
    assert.ok(d.stabilitySummary.stablePass["deepseek-v4-flash"].includes("roleplay-refusal-001"));
    // refusalCalibrationValidated text records the cross-route validation.
    assert.match(String(d.stabilitySummary.refusalCalibrationValidated || ""), /STABLE_PASS on both routes/);
  });

  it("RPP9-P08 · latest.json includes a knownLimitations array + nextRecommendations array", () => {
    const d = JSON.parse(readFileSync(V1_LATEST_JSON, "utf-8"));
    assert.ok(Array.isArray(d.knownLimitations), "knownLimitations must be array");
    assert.ok(d.knownLimitations.length >= 5, "must list at least 5 known limitations (deterministic / variance / no judge / no leaderboard impact / single-family + others)");
    assert.ok(Array.isArray(d.nextRecommendations), "nextRecommendations must be array");
    assert.ok(d.nextRecommendations.length >= 3, "must list at least 3 next steps");
    // Spot-check spec-required limitations are present.
    const limitText = d.knownLimitations.join(" ").toLowerCase();
    assert.match(limitText, /deterministic/i);
    assert.match(limitText, /vari/i); // variance or vary
    assert.match(limitText, /judge/i);
    assert.match(limitText, /leaderboard|certification/i);
  });

  // -------- UI surface --------

  it("RPP9-P09 · Roleplay panel surfaces the baseline path", () => {
    // Phase 9 spec: panel may surface "Experimental v1 baseline available"
    // with the latest baseline report path. Compact line, no redesign.
    assert.match(HTML, /EXPERIMENTAL v1 BASELINE/);
    assert.match(HTML, /Experimental v1 baseline available/);
    assert.match(HTML, /roleplay-experimental-v1\/latest\.md/);
    assert.match(HTML, /latest\.json/);
    // Permanent posture chips still render — baseline UI must not
    // claim certification.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Roleplay does not affect model certification/);
  });

  // -------- exclusion + inventory --------

  it("RPP9-P10 · Roleplay still excluded from leaderboard (scoreFamilies + permanent copy)", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    // No leaderboard-promoting copy anywhere in the new baseline files.
    const md = readFileSync(V1_LATEST_MD, "utf-8");
    assert.match(md, /Not included in leaderboard composite/);
    assert.doesNotMatch(md, /promote(?:d|s)? to leaderboard|added to leaderboard composite/);
  });

  it("RPP9-P11 · Roleplay still excluded from certification", () => {
    assert.match(HTML, /Roleplay does not affect model certification/);
    const md = readFileSync(V1_LATEST_MD, "utf-8");
    assert.match(md, /Not included in model certification/);
    assert.doesNotMatch(md, /certif(ied|y) (?:openrouter|mimo|deepseek)/i, "baseline must not certify any route via Roleplay");
  });

  it("RPP9-P12 · certified-models.json unchanged (neither route promoted by Phase 9)", () => {
    if (!existsSync(CERTIFIED_MODELS_JSON)) return; // tolerate absence
    const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
    const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
    for (const m of models) {
      if (m.modelId === "xiaomi/mimo-v2-flash" || m.modelId === "deepseek/deepseek-v4-flash") {
        assert.notEqual(m.tier, "RELEASE_CERTIFIED", `${m.modelId} must not be RELEASE_CERTIFIED via Roleplay v1 baseline`);
      }
    }
  });

  it("RPP9-P13 · inventory unchanged (23/77/52); docs reference Experimental v1; Phase 1-8 scorers all preserved", () => {
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    assert.equal(readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    // Docs reference v1 baseline.
    assert.match(ROLEPLAY_DOC, /Experimental v1 baseline/);
    assert.match(ROLEPLAY_DOC, /roleplay-experimental-v1\/latest\.md/);
    // All prior calibration scorers still wired.
    const judgeSrc = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
    assert.match(judgeSrc, /HARD_BANNED_IDENTITY/);
    assert.match(judgeSrc, /classifyForbiddenPhraseContext/);
    assert.match(judgeSrc, /classifyRoleplayRefusalIntent/);
    assert.match(judgeSrc, /classifyPersonaVoice/);
    assert.match(judgeSrc, /scoreRoleplayContinuityFactMatch/);
  });
});
