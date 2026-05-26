/**
 * Crucible — Capability Certification Doctrine (Doctrine v1) tests.
 *
 * 12 deterministic offline assertions pinning the doctrine guarantees
 * defined in `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` and
 * implemented in `core/capability-certification.ts` +
 * `core/capability-certification-types.ts`.
 *
 * No provider calls. No network. The evaluator is read-only and never
 * mutates any registry, so these tests can run as pure unit checks.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  evaluatePromotion,
  VISION_GATES,
  ROLEPLAY_GATES,
  gateSpecFor,
} from "../core/capability-certification.js";
import type {
  CapabilityRouteCertification,
  CapabilityEvidenceRef,
} from "../core/capability-certification-types.js";

const ROOT = process.cwd();
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");

const EV: CapabilityEvidenceRef[] = [{ kind: "smoke", path: "reports/capability-expansion/vision-smoke/latest.json" }];

describe("Capability Certification Doctrine v1 (offline)", () => {
  // -------- Doctrine guarantee 1+2: EXPERIMENTAL never affects leaderboard / certification --------

  it("CCD-P01 · EXPERIMENTAL cannot affect leaderboard (literal-false typing + runtime payload)", () => {
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "EXPERIMENTAL", proposedTier: "EXPERIMENTAL",
      suiteSize: 5, repeatRuns: 0, stablePassRate: 0,
      independentRoutesTested: 1, recurringAttributions: [], evidenceRefs: [],
    });
    assert.equal(decision.affectsLeaderboard, false);
    // Compile-time check: the field is typed as the literal `false`.
    // The next line documents that intent — assignment to true would
    // be a tsc error.
    const _affects: false = decision.affectsLeaderboard; void _affects;
    // EXPERIMENTAL is the default unguarded tier — eligible without
    // evidence (Vision starts here today).
    assert.equal(decision.eligible, true);
  });

  it("CCD-P02 · EXPERIMENTAL cannot affect certification (literal-false typing + runtime payload)", () => {
    const decision = evaluatePromotion({
      capability: "roleplay",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-flash",
      currentTier: "EXPERIMENTAL", proposedTier: "EXPERIMENTAL",
      suiteSize: 7, repeatRuns: 0, stablePassRate: 0,
      independentRoutesTested: 1, recurringAttributions: [], evidenceRefs: [],
    });
    assert.equal(decision.affectsCertification, false);
    const _affects: false = decision.affectsCertification; void _affects;
  });

  // -------- Doctrine guarantee 3: PROVIDER_TESTED requires evidence refs --------

  it("CCD-P03 · PROVIDER_TESTED requires non-empty evidenceRefs", () => {
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "EXPERIMENTAL", proposedTier: "PROVIDER_TESTED",
      suiteSize: 5, repeatRuns: 1, stablePassRate: 1.0,
      independentRoutesTested: 1, recurringAttributions: [], evidenceRefs: [],
    });
    assert.equal(decision.eligible, false);
    assert.ok(decision.blockingReasons.some((b) => b.gate === "vision.provider-tested.evidence"));
    // Same input WITH evidence → eligible.
    const decision2 = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "EXPERIMENTAL", proposedTier: "PROVIDER_TESTED",
      suiteSize: 5, repeatRuns: 1, stablePassRate: 1.0,
      independentRoutesTested: 1, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(decision2.eligible, true, `should be eligible with evidence: ${JSON.stringify(decision2.blockingReasons)}`);
  });

  // -------- Doctrine guarantee 4: STABLE requires stability evidence (repeat runs) --------

  it("CCD-P04 · STABLE requires stability evidence (low repeat-run count blocks)", () => {
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "PROVIDER_TESTED", proposedTier: "STABLE",
      suiteSize: 5, repeatRuns: 1, stablePassRate: 1.0,
      independentRoutesTested: 1, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(decision.eligible, false);
    assert.ok(decision.blockingReasons.some((b) => b.gate === "vision.stable.repeat-runs"), `missing repeat-runs blocker: ${JSON.stringify(decision.blockingReasons)}`);
  });

  // -------- Doctrine guarantee 5: CAPABILITY_CERTIFIED requires expanded-suite threshold --------

  it("CCD-P05 · CAPABILITY_CERTIFIED requires expanded suite (Vision 15+, Roleplay 20+)", () => {
    // Vision with current 5-test POC suite is below the 15-test threshold.
    const v = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "STABLE", proposedTier: "CAPABILITY_CERTIFIED",
      suiteSize: 5, repeatRuns: 3, stablePassRate: 1.0,
      independentRoutesTested: 3, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(v.eligible, false);
    assert.ok(v.blockingReasons.some((b) => b.gate === "vision.capability-certified.suite-size"));
    // Roleplay with current 7-test POC suite is below the 20-test threshold.
    const r = evaluatePromotion({
      capability: "roleplay",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-flash",
      currentTier: "STABLE", proposedTier: "CAPABILITY_CERTIFIED",
      suiteSize: 7, repeatRuns: 5, stablePassRate: 1.0,
      independentRoutesTested: 3, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(r.eligible, false);
    assert.ok(r.blockingReasons.some((b) => b.gate === "roleplay.capability-certified.suite-size"));
  });

  // -------- Doctrine guarantee 6+7: Vision/Roleplay current suites cannot certify --------

  it("CCD-P06 · Vision with only 5 tests cannot achieve CAPABILITY_CERTIFIED (current state)", () => {
    const v = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-omni",
      currentTier: "STABLE", proposedTier: "CAPABILITY_CERTIFIED",
      suiteSize: 5, repeatRuns: 3, stablePassRate: 1.0,
      independentRoutesTested: 2, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(v.eligible, false);
    // Two blockers minimum at current state: suite-size (5 < 15) +
    // independent-routes (2 < 3 — Vision has only 2 routes tested).
    const gates = v.blockingReasons.map((b) => b.gate);
    assert.ok(gates.includes("vision.capability-certified.suite-size"));
    assert.ok(gates.includes("vision.capability-certified.independent-routes"));
  });

  it("CCD-P07 · Roleplay with only 7 tests cannot achieve CAPABILITY_CERTIFIED (current state)", () => {
    const r = evaluatePromotion({
      capability: "roleplay",
      providerId: "openrouter", modelId: "xiaomi/mimo-v2-flash",
      currentTier: "STABLE", proposedTier: "CAPABILITY_CERTIFIED",
      suiteSize: 7, repeatRuns: 5, stablePassRate: 1.0,
      independentRoutesTested: 2, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(r.eligible, false);
    const gates = r.blockingReasons.map((b) => b.gate);
    assert.ok(gates.includes("roleplay.capability-certified.suite-size"));
    assert.ok(gates.includes("roleplay.capability-certified.independent-routes"));
  });

  // -------- Doctrine guarantee 8: BLOCKED route cannot claim support --------

  it("CCD-P08 · BLOCKED_UNSUPPORTED route cannot move to any non-EXPERIMENTAL tier without explicit re-test", () => {
    const v = evaluatePromotion({
      capability: "vision",
      providerId: "ollama", modelId: "qwen3.5:9b", // text-only model in registry
      currentTier: "BLOCKED_UNSUPPORTED", proposedTier: "STABLE",
      suiteSize: 5, repeatRuns: 3, stablePassRate: 1.0,
      independentRoutesTested: 3, recurringAttributions: [], evidenceRefs: EV,
    });
    assert.equal(v.eligible, false);
    assert.ok(v.blockingReasons.some((b) => b.gate === "vision.stable.blocked-resolution"));
  });

  // -------- Doctrine guarantee 9: capability badges remain separate from main leaderboard --------

  it("CCD-P09 · capability tiers remain compile-time separate from main leaderboard / general certification", () => {
    // Type-level guarantee: CapabilityRouteCertification carries the
    // literal-false fields. Construct a value; the literal `false`
    // typing means a future code edit that tries `affectsLeaderboard: true`
    // would fail tsc.
    const route: CapabilityRouteCertification = {
      capability: "vision",
      providerId: "openrouter",
      modelId: "xiaomi/mimo-v2-omni",
      adapterPath: "openrouter",
      tier: "EXPERIMENTAL",
      evidence: [],
      affectsLeaderboard: false,
      affectsCertification: false,
      generatedAt: new Date().toISOString(),
    };
    assert.equal(route.affectsLeaderboard, false);
    assert.equal(route.affectsCertification, false);
    // Doctrine never wires capability tier into MODEL_CERTIFICATION.
    // Static check: the registry shape uses `tier` for general tier
    // (RELEASE_CERTIFIED / PROVIDER_TESTED / etc) and the capability
    // shape uses `tier` for capability tier — different scopes, never
    // a single combined value.
    assert.match(HTML, /tier:'RELEASE_CERTIFIED'|tier:'PROVIDER_TESTED'|tier:'EXPERIMENTAL'/);
    // Neither doctrine type appears in the main MODEL_CERTIFICATION
    // tier strings — proof they're separate scopes.
    assert.doesNotMatch(HTML, /tier:'CAPABILITY_CERTIFIED'/);
    assert.doesNotMatch(HTML, /tier:'BLOCKED_UNSUPPORTED'/);
  });

  // -------- Doctrine guarantee 10+11: Vision + Roleplay exclusion tests preserved --------

  it("CCD-P10 · existing Vision tab exclusion preserved (scoreFamilies still [], chips still render)", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Vision does not affect model certification/);
  });

  it("CCD-P11 · existing Roleplay tab exclusion preserved (scoreFamilies still [], chips still render)", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Roleplay does not affect model certification/);
  });

  // -------- Doctrine guarantee 12: certified-models.json untouched --------

  it("CCD-P12 · certified-models.json unchanged (no capability promotion writes to it)", () => {
    // Doctrine v1 explicitly forbids the evaluator from mutating
    // any registry. If certified-models.json exists, verify no
    // currently-tested capability route was promoted via Roleplay
    // or Vision.
    if (!existsSync(CERTIFIED_MODELS_JSON)) return; // tolerate absence
    const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
    const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
    for (const m of models) {
      // No model should be RELEASE_CERTIFIED for any of the
      // capability-tested routes via capability evidence alone.
      if (
        m.modelId === "xiaomi/mimo-v2-omni" ||
        m.modelId === "gpt-5.4-mini" ||
        m.modelId === "xiaomi/mimo-v2-flash" ||
        m.modelId === "deepseek/deepseek-v4-flash"
      ) {
        assert.notEqual(m.tier, "RELEASE_CERTIFIED", `${m.modelId} must not be RELEASE_CERTIFIED via Vision/Roleplay capability tier`);
      }
    }
    // Inventory unchanged (no new tasks were added this phase).
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 5);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    // Gate-spec lookup sanity: doctrine ships specs for both
    // capabilities and all 5 tiers.
    for (const cap of ["vision", "roleplay"] as const) {
      for (const tier of ["EXPERIMENTAL", "PROVIDER_TESTED", "STABLE", "CAPABILITY_CERTIFIED", "BLOCKED_UNSUPPORTED"] as const) {
        const spec = gateSpecFor(cap, tier);
        assert.equal(spec.capability, cap);
        assert.equal(spec.tier, tier);
      }
    }
    // Vision STABLE pass-rate threshold is 80%, doctrine-locked.
    assert.equal(VISION_GATES.STABLE.minStablePassRate, 0.80);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minSuiteSize, 15);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes, 3);
    assert.equal(ROLEPLAY_GATES.STABLE.minRepeatRuns, 5);
    assert.equal(ROLEPLAY_GATES.CAPABILITY_CERTIFIED.minSuiteSize, 20);
    assert.equal(ROLEPLAY_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes, 3);
  });
});
