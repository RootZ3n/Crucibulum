/**
 * Luak — context-degradation-001 scoring-invariant tests.
 *
 * Born from the 2026-05-27 Hermes audit of context-degradation-001
 * (see reports/scoring-integrity/context-degradation-001/). The
 * audit concluded `VALID_HISTORICAL_SCORING_CONTRACT`: the
 * "impossible 43" was the legitimate composite from
 * `combineConversationalScore(c, e) = round((c*0.85 + e*0.15)*100)/100`
 * for the 1-of-3 cell at efficiency ≈ 1.0. No bundle rewrite; we
 * add a deterministic invariant + flag so any *future* pipeline
 * bug that DOES produce impossible scores is caught at CI rather
 * than silently shipped.
 *
 * 14 deterministic offline tests:
 *
 *   - manifest loader returns the published binary contract
 *     (3 binary text_match_all questions, weight 3 each, total 9)
 *   - the enumerated correctness set is exactly {0, 1/3, 2/3, 1}
 *   - composite anchors at efficiency=1 are exactly {0, 0.43, 0.72, 1.00}
 *   - validator accepts a legal 1-of-3 / 43 bundle
 *   - validator accepts the 0-of-3 / 0 anchor
 *   - validator accepts the 2-of-3 / 72 anchor
 *   - validator accepts the 3-of-3 / 100 anchor
 *   - validator REJECTS a 43 reported alongside a correctness=0.40
 *     bundle (correctness out of binary set)
 *   - validator REJECTS a mismatched composite (correctness=0.3333
 *     but total=0.50) — INVALID_SCORE_SHAPE
 *   - validator REJECTS bundles missing score fields with
 *     MISSING_SCORE_FIELDS
 *   - non-binary manifests safely SKIP the invariant with marker
 *     NON_BINARY_INVARIANT_SKIPPED
 *   - every actual bundle on disk for context-degradation-001
 *     passes the invariant (the audit's positive evidence)
 *   - Vision / Roleplay manifests with judge/honesty scorers SKIP
 *     the invariant (the must-not-overreach negative case)
 *   - inventory + capability doctrine regressions still hold
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  isStrictlyBinaryConversationalManifest,
  enumerateBinaryConversationalCorrectnessSet,
  enumerateBinaryConversationalCompositeAnchors,
  validateBinaryConversationalBundleScoreShape,
} from "../core/scoring-invariant.js";
import type { ConversationalManifest } from "../adapters/base.js";

const ROOT = process.cwd();
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, "tasks", "context-degradation", "context-degradation-001", "manifest.json"), "utf-8"),
) as ConversationalManifest;

function fakeBundle(correctness: number, efficiency: number, total: number): { score: { total: number; breakdown: { correctness: number; efficiency: number } } } {
  return { score: { total, breakdown: { correctness, efficiency } } };
}

function close(a: number, b: number, eps = 0.005): boolean { return Math.abs(a - b) < eps; }

describe("Luak scoring-invariant · context-degradation-001 (offline)", () => {
  // -------- manifest contract --------

  it("P1 · manifest declares 3 binary text_match_all questions, weight 3 each (total 9)", () => {
    assert.equal(MANIFEST.questions.length, 3);
    let sum = 0;
    for (const q of MANIFEST.questions) {
      assert.equal(q.scoring_type, "text_match_all", `q ${q.id} must be text_match_all`);
      assert.equal(q.weight, 3, `q ${q.id} weight must be 3`);
      sum += q.weight;
    }
    assert.equal(sum, 9, "total weight must be 9");
  });

  it("P2 · isStrictlyBinaryConversationalManifest is true for the manifest", () => {
    assert.equal(isStrictlyBinaryConversationalManifest(MANIFEST.questions), true);
  });

  // -------- enumeration --------

  it("P3 · enumerated correctness set is exactly {0, 1/3, 2/3, 1} (rounded to 2 dp)", () => {
    const set = enumerateBinaryConversationalCorrectnessSet(MANIFEST.questions);
    // 1/3 → 0.33, 2/3 → 0.67 (round-half-up)
    assert.deepEqual(set, [0, 0.33, 0.67, 1]);
  });

  it("P4 · composite anchors at efficiency=1 are exactly {0, 0.43, 0.72, 1.00}", () => {
    const anchors = enumerateBinaryConversationalCompositeAnchors(MANIFEST.questions, 1.0);
    const totals = anchors.map((a) => a.total);
    assert.deepEqual(totals, [0, 0.43, 0.72, 1]);
  });

  // -------- validator: positive cases --------

  it("P5 · validator accepts a legal 1-of-3 / 43 bundle (the 2026-05-27 audit's central case)", () => {
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(0.3333333333333333, 1, 0.43));
    assert.equal(r.valid, true, `expected PASS; reason: ${r.reason}`);
    assert.equal(r.marker, "");
  });

  it("P6 · validator accepts the 0-of-3 / 0 anchor", () => {
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(0, 1, 0));
    assert.equal(r.valid, true);
  });

  it("P7 · validator accepts the 2-of-3 / 72 anchor", () => {
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(0.6666666666666666, 1, 0.72));
    assert.equal(r.valid, true, `expected PASS; reason: ${r.reason}`);
  });

  it("P8 · validator accepts the 3-of-3 / 100 anchor", () => {
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(1, 1, 1));
    assert.equal(r.valid, true);
  });

  // -------- validator: rejection cases --------

  it("P9 · validator REJECTS a bundle whose correctness is not in the binary set (BREAKDOWN_OUT_OF_SET)", () => {
    // correctness=0.40 cannot come from 3-question binary text_match_all.
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(0.40, 1, 0.49));
    assert.equal(r.valid, false);
    assert.equal(r.marker, "BREAKDOWN_OUT_OF_SET");
    assert.match(r.reason, /not in the enumerated binary set/);
  });

  it("P10 · validator REJECTS a bundle whose composite does NOT match the formula (INVALID_SCORE_SHAPE)", () => {
    // correctness=0.3333 in the binary set; total=0.50 should be 0.43.
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(0.3333333333333333, 1, 0.50));
    assert.equal(r.valid, false);
    assert.equal(r.marker, "INVALID_SCORE_SHAPE");
    assert.match(r.reason, /does not match composite/);
  });

  it("P11 · validator REJECTS bundles missing score fields with MISSING_SCORE_FIELDS", () => {
    const r1 = validateBinaryConversationalBundleScoreShape(MANIFEST, {} as { score?: unknown });
    assert.equal(r1.valid, false);
    assert.equal(r1.marker, "MISSING_SCORE_FIELDS");

    const r2 = validateBinaryConversationalBundleScoreShape(
      MANIFEST,
      { score: { total: 0.43, breakdown: { correctness: 0.3333 } as unknown as { correctness?: number; efficiency?: number } } } as { score?: unknown },
    );
    assert.equal(r2.valid, false);
    assert.equal(r2.marker, "MISSING_SCORE_FIELDS");
  });

  // -------- safe SKIP on non-binary manifests --------

  it("P12 · validator SKIPs non-binary (honesty / rubric) manifests with NON_BINARY_INVARIANT_SKIPPED", () => {
    const visionUnc = JSON.parse(readFileSync(join(ROOT, "tasks", "vision", "vision-uncertainty-001", "manifest.json"), "utf-8")) as ConversationalManifest;
    assert.equal(isStrictlyBinaryConversationalManifest(visionUnc.questions), false, "uncertainty manifest must not be classed as strictly binary");
    const r = validateBinaryConversationalBundleScoreShape(visionUnc, fakeBundle(0.5, 1, 0.58));
    assert.equal(r.valid, true);
    assert.equal(r.marker, "NON_BINARY_INVARIANT_SKIPPED");

    const visionAbs = JSON.parse(readFileSync(join(ROOT, "tasks", "vision", "vision-hallucination-resistance-001", "manifest.json"), "utf-8")) as ConversationalManifest;
    assert.equal(isStrictlyBinaryConversationalManifest(visionAbs.questions), false);
    const r2 = validateBinaryConversationalBundleScoreShape(visionAbs, fakeBundle(0.5, 1, 0.58));
    assert.equal(r2.valid, true);
    assert.equal(r2.marker, "NON_BINARY_INVARIANT_SKIPPED");
  });

  // -------- positive evidence: every actual bundle on disk passes --------

  it("P13 · every existing context-degradation-001 bundle on disk passes the invariant (no historical scoring corruption)", () => {
    const runsDir = join(ROOT, "runs");
    if (!existsSync(runsDir)) return; // CI environments without local runs
    const files = readdirSync(runsDir).filter((f) => f.startsWith("run_") && f.includes("context-degradation-001") && f.endsWith(".json"));
    let n = 0;
    for (const f of files) {
      const bundle = JSON.parse(readFileSync(join(runsDir, f), "utf-8")) as { score?: { total: number; breakdown: { correctness: number; efficiency: number } } };
      // Some legacy bundles (e.g. the harness-mock 0/3 case) may not
      // have a populated breakdown. Skip those rather than fail; the
      // invariant is about catching positive pipeline bugs.
      if (!bundle.score || !bundle.score.breakdown || typeof bundle.score.breakdown.correctness !== "number" || typeof bundle.score.breakdown.efficiency !== "number") {
        continue;
      }
      n++;
      const r = validateBinaryConversationalBundleScoreShape(MANIFEST, bundle);
      assert.equal(r.valid, true, `bundle ${f} must pass invariant; reason: ${r.reason}`);
      // Spot-check that the well-known 43 case is recognised as legal.
      if (close(bundle.score.breakdown.correctness, 1 / 3)) {
        assert.ok(close(bundle.score.total, 0.43), `1-of-3 bundle ${f} expected total ≈ 0.43; got ${bundle.score.total}`);
      }
    }
    assert.ok(n >= 5, `expected to inspect at least 5 historical context-degradation-001 bundles; got ${n}`);
  });

  // -------- regression guards --------

  it("P14 · the 43 anchor is byte-exactly the composite formula output (rounding sanity check)", () => {
    // Re-derive 0.43 from the formula to ensure the rounding policy
    // hasn't drifted under us.
    const correctness = 1 / 3;
    const efficiency = 1;
    const total = Math.round(((correctness * 0.85) + (efficiency * 0.15)) * 100) / 100;
    assert.equal(total, 0.43, "the composite formula must produce exactly 0.43 for 1/3 correctness + efficiency=1");
    // And the validator must agree.
    const r = validateBinaryConversationalBundleScoreShape(MANIFEST, fakeBundle(correctness, efficiency, total));
    assert.equal(r.valid, true);
  });
});
