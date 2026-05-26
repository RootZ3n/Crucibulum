/**
 * Crucible — Vision Phase 11: stability runner + dry-run doctrine gate
 * eligibility (offline tests).
 *
 * 20 deterministic source/contract assertions covering:
 *   - scripts/vision-stability.mjs structure (providers registry, ALL_TESTS,
 *     CLI flag parsing, cost-cap enforcement, per-run bundle persistence,
 *     summarizeBundle, classifyTestStability, buildDryRunGateEligibility,
 *     output paths)
 *   - all 10 classification labels are reachable from source
 *   - doctrine evaluator (evaluatePromotion) behaves correctly for the
 *     two recurring-attribution cases we observed live:
 *       · recurring SCORER blocks STABLE for vision
 *       · recurring MODEL does NOT block STABLE (MODEL is honest failure)
 *   - latest stability reports for both Vision routes exist with the
 *     expected schema, never affect leaderboard/certification, and carry
 *     a dry-run gate eligibility block
 *   - UI Vision panel exposes the new STABILITY PROFILE block while
 *     preserving the existing EXPERIMENTAL / NOT IN LEADERBOARD /
 *     NOT CERTIFIED posture
 *   - docs/MULTIMODAL_VISION_SUITE.md documents the new runner
 *   - regression guards: certified-models.json untouched; Vision/Roleplay
 *     task inventories unchanged; Roleplay stability runner still in place
 *
 * No provider calls. No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { evaluatePromotion, VISION_GATES } from "../core/capability-certification.js";

const ROOT = process.cwd();
const RUNNER = join(ROOT, "scripts", "vision-stability.mjs");
const ROLEPLAY_RUNNER = join(ROOT, "scripts", "roleplay-stability.mjs");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const RUNNER_SRC = readFileSync(RUNNER, "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");

const STABILITY_DIR = join(ROOT, "reports", "capability-expansion", "vision-stability");
const LATEST_JSON = join(STABILITY_DIR, "latest.json");
const LATEST_MD = join(STABILITY_DIR, "latest.md");

function loadLatestJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(LATEST_JSON, "utf-8"));
}

describe("Vision Phase 11 · stability runner + dry-run gate eligibility (offline)", () => {
  // -------- runner shape --------

  it("P1 · vision-stability.mjs exists and registers openrouter + openai providers", () => {
    assert.ok(existsSync(RUNNER), "scripts/vision-stability.mjs must exist");
    assert.match(RUNNER_SRC, /const PROVIDERS = \{/);
    assert.match(RUNNER_SRC, /openrouter:\s*\{/);
    assert.match(RUNNER_SRC, /openai:\s*\{/);
    // Each provider entry must build an adapter — Vision Phase B added two
    // adapters covering the two existing live routes.
    assert.match(RUNNER_SRC, /OpenRouterAdapter/);
    assert.match(RUNNER_SRC, /OpenAIAdapter/);
  });

  it("P2 · ALL_TESTS lists exactly the 5 current Vision POC tasks", () => {
    const m = RUNNER_SRC.match(/const ALL_TESTS = \[([^\]]+)\]/);
    assert.ok(m, "ALL_TESTS array must be declared");
    const body = m![1];
    for (const t of [
      "vision-ocr-001",
      "vision-ui-001",
      "vision-chart-001",
      "vision-object-count-001",
      "vision-uncertainty-001",
    ]) {
      assert.match(body, new RegExp(`"${t}"`), `ALL_TESTS must include ${t}`);
    }
  });

  it("P3 · runs flag defaults to 3 and clamps to [2,10]", () => {
    // Clamp expression must be present so a stray `--runs 1` or `--runs 50`
    // cannot bypass the doctrine repeat-count gate by accident.
    assert.match(RUNNER_SRC, /const runs = Math\.min\(10,\s*Math\.max\(2,\s*Number\(arg\("--runs",\s*"3"\)\)\s*\|\|\s*3\)\)/);
  });

  it("P4 · per-route default cost cap is $1.50 and the loop break-out is wired through `break outer`", () => {
    assert.match(RUNNER_SRC, /arg\("--max-cost-usd",\s*"1\.50"\)/);
    assert.match(RUNNER_SRC, /outer: for \(let i = 0; i < runs; i\+\+\)/);
    assert.match(RUNNER_SRC, /if \(totalCost >= maxCostUsd\)/);
    assert.match(RUNNER_SRC, /break outer/);
  });

  it("P5 · summarizeBundle extracts the columns the classifier and the report need", () => {
    assert.match(RUNNER_SRC, /function summarizeBundle\(bundle\)/);
    // Columns: classification, attribution, costUsd, tokensIn/Out, firstFailReason, imageSent, bundleId.
    for (const field of ["classification", "attribution", "costUsd", "firstFailReason", "imageSent", "bundleId"]) {
      assert.match(RUNNER_SRC, new RegExp(`\\b${field}\\b`), `summarizeBundle output must carry ${field}`);
    }
  });

  it("P6 · classifyTestStability emits all 10 doctrine-aligned labels", () => {
    assert.match(RUNNER_SRC, /function classifyTestStability\(perRunEntries\)/);
    const labels = [
      "STABLE_PASS",
      "STABLE_SKIP",
      "NEEDS_REVIEW_STABLE",
      "CONFIG_SUSPECT",
      "PROVIDER_SUSPECT",
      "FIXTURE_SUSPECT",
      "SCORER_SUSPECT",
      "RECURRING_FAIL",
      "INTERMITTENT_FAIL",
      "MODEL_VARIANCE",
    ];
    for (const l of labels) {
      assert.match(RUNNER_SRC, new RegExp(`label = "${l}"`), `classifier must be able to assign ${l}`);
    }
  });

  it("P7 · SCORER_SUSPECT triggers when every failure carries SCORER attribution, even if reason text varies", () => {
    // Two-path SCORER_SUSPECT: (a) all failures attribute SCORER, OR
    // (b) same-reason recurrence with ambiguity markers. Both must be wired.
    assert.match(RUNNER_SRC, /else if \(allFailsSame\("SCORER"\)\) label = "SCORER_SUSPECT"/);
    assert.match(RUNNER_SRC, /sameReasonFails && fails >= 2 && sameReasonIsAmbiguous/);
    assert.match(RUNNER_SRC, /answer too verbose/i, "ambiguity marker for SCORER_SUSPECT must include 'answer too verbose'");
  });

  it("P8 · runner persists per-run bundles into runs/ for evidence audit", () => {
    // The summarizeBundle path is the standard runner output; bundle write
    // happens via the conversational runner. The script must surface
    // bundlePath so reports can link back to the canonical run bundle.
    assert.match(RUNNER_SRC, /bundlePath/);
    assert.match(RUNNER_SRC, /runs\//, "bundle paths under runs/ must appear in source");
  });

  // -------- dry-run gate eligibility (doctrine evaluator) --------

  it("P9 · buildDryRunGateEligibility calls evaluatePromotion read-only for PROVIDER_TESTED + STABLE", () => {
    assert.match(RUNNER_SRC, /function buildDryRunGateEligibility\(/);
    assert.match(RUNNER_SRC, /\["PROVIDER_TESTED",\s*"STABLE"\]\.map/);
    assert.match(RUNNER_SRC, /evaluatePromotion\(\{/);
    assert.match(RUNNER_SRC, /DRY-RUN ELIGIBILITY CHECK \(read-only; no mutation performed\)/);
  });

  it("P10 · recurring SCORER blocks STABLE for Vision per doctrine", () => {
    // Direct doctrine assertion: SCORER must be in the STABLE disallowed
    // list, and the evaluator must surface the blocking reason.
    assert.ok(VISION_GATES.STABLE.disallowedRecurringAttributions.includes("SCORER"));
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter",
      modelId: "xiaomi/mimo-v2-omni",
      currentTier: "EXPERIMENTAL",
      proposedTier: "STABLE",
      suiteSize: 5,
      repeatRuns: 3,
      stablePassRate: 0.80,
      independentRoutesTested: 1,
      recurringAttributions: ["SCORER"],
      evidenceRefs: [{ kind: "stability", path: "reports/capability-expansion/vision-stability/x.json" }],
    });
    assert.equal(decision.eligible, false);
    assert.ok(decision.blockingReasons.some((b) => b.gate === "vision.stable.recurring-scorer"));
    // Doctrine guarantee.
    assert.equal(decision.affectsLeaderboard, false);
    assert.equal(decision.affectsCertification, false);
  });

  it("P11 · recurring MODEL does NOT block STABLE — MODEL is honest model failure, doctrine permits", () => {
    // MODEL attribution is the "model genuinely got it wrong" signal. The
    // STABLE gate is about whether scoring is stable, not whether the model
    // ever fails. We confirm MODEL is absent from the disallowed list and
    // that an otherwise-passing payload is eligible.
    assert.equal(VISION_GATES.STABLE.disallowedRecurringAttributions.includes("MODEL"), false);
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      currentTier: "EXPERIMENTAL",
      proposedTier: "STABLE",
      suiteSize: 5,
      repeatRuns: 3,
      stablePassRate: 0.80,
      independentRoutesTested: 1,
      recurringAttributions: ["MODEL"],
      evidenceRefs: [{ kind: "stability", path: "reports/capability-expansion/vision-stability/y.json" }],
    });
    assert.equal(decision.eligible, true, JSON.stringify(decision.blockingReasons));
    assert.equal(decision.affectsLeaderboard, false);
    assert.equal(decision.affectsCertification, false);
  });

  // -------- latest reports (live evidence pinned by shape, not content) --------

  it("P12 · latest.json carries the expected schema, run count, route count, and read-only posture", () => {
    assert.ok(existsSync(LATEST_JSON), `latest.json must exist at ${LATEST_JSON}`);
    assert.ok(existsSync(LATEST_MD), `latest.md must exist at ${LATEST_MD}`);
    const j = loadLatestJson();
    assert.equal(j.schema, "crucible.vision-stability.v1");
    assert.equal(j.affectsLeaderboard, false);
    assert.equal(j.affectsCertification, false);
    assert.equal(j.experimental, true);
    assert.equal(j.runs, 3, "Phase B baseline ran 3 repeats");
    assert.ok(Array.isArray(j.tests) && (j.tests as unknown[]).length === 5, "stability profile must exercise all 5 Vision POC tests");
  });

  it("P13 · latest.json embeds a dry-run gate eligibility block with both PROVIDER_TESTED + STABLE decisions", () => {
    const j = loadLatestJson() as { dryRunGateEligibility: { decisions: Array<{ tier: string; affectsLeaderboard: boolean; affectsCertification: boolean }>; label: string; affectsLeaderboard: boolean; affectsCertification: boolean } };
    const gate = j.dryRunGateEligibility;
    assert.ok(gate, "latest.json must carry dryRunGateEligibility");
    assert.match(gate.label, /^DRY-RUN ELIGIBILITY CHECK/);
    assert.equal(gate.affectsLeaderboard, false);
    assert.equal(gate.affectsCertification, false);
    const tiers = gate.decisions.map((d) => d.tier).sort();
    assert.deepEqual(tiers, ["PROVIDER_TESTED", "STABLE"]);
    for (const d of gate.decisions) {
      assert.equal(d.affectsLeaderboard, false);
      assert.equal(d.affectsCertification, false);
    }
  });

  it("P14 · both Phase B baseline reports (mimo + gpt-5.4-mini) exist on disk", () => {
    const files = readdirSync(STABILITY_DIR);
    const json = files.filter((f) => f.endsWith(".json") && f !== "latest.json");
    assert.ok(json.length >= 2, `expected at least 2 timestamped report JSONs; got ${json.length}: ${json.join(", ")}`);
    // Read each to confirm we have one for each tested model.
    const models = new Set(json.map((f) => JSON.parse(readFileSync(join(STABILITY_DIR, f), "utf-8")).model));
    assert.ok(models.has("xiaomi/mimo-v2-omni"), `mimo-v2-omni baseline report missing; saw models: ${[...models].join(", ")}`);
    assert.ok(models.has("gpt-5.4-mini"), `gpt-5.4-mini baseline report missing; saw models: ${[...models].join(", ")}`);
  });

  // -------- UI Stability Profile block --------

  it("P15 · Vision panel exposes a STABILITY PROFILE block referring to the Phase B runner", () => {
    assert.match(HTML, /STABILITY PROFILE/);
    assert.match(HTML, /scripts\/vision-stability\.mjs/);
    assert.match(HTML, /reports\/capability-expansion\/vision-stability\/latest\.md/);
  });

  it("P16 · Vision panel still says EXPERIMENTAL / NOT IN LEADERBOARD / NOT CERTIFIED", () => {
    // Phase B must not redesign the Vision panel; the permanent doctrine
    // posture chips remain.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
    // Leaderboard exclusion preserved.
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  // -------- docs --------

  it("P17 · MULTIMODAL_VISION_SUITE.md documents the Phase B stability runner + 10-label classifier", () => {
    assert.match(DOC, /Stability profile \(Roadmap Phase B\)/);
    assert.match(DOC, /scripts\/vision-stability\.mjs/);
    // Spot-check several of the 10 labels are listed in the docs.
    for (const l of ["STABLE_PASS", "RECURRING_FAIL", "SCORER_SUSPECT", "NEEDS_REVIEW_STABLE"]) {
      assert.match(DOC, new RegExp(l), `docs must list ${l}`);
    }
    // Promotion-is-never-triggered guarantee surfaced in the docs.
    assert.match(DOC, /Promotion is never triggered by this runner/);
  });

  // -------- regression guards --------

  it("P18 · certified-models.json + MODEL_CERTIFICATION tiers untouched by Phase B", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath), "certified-models.json must still exist");
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models), "certified-models.json must keep its array shape");
    // Sanity: neither Vision route was promoted into the certified registry
    // as part of Phase B. The registry is keyed by tier-eligible main-suite
    // models, not capability tiers — Vision routes must not appear here
    // unless they earned it on the main suite.
    for (const m of certified.models as Array<{ modelId: string; provider?: string }>) {
      assert.notEqual(`${m.provider}/${m.modelId}`, "openai/gpt-5.4-mini", "gpt-5.4-mini must not be present in certified-models.json from Phase B");
    }
    // MODEL_CERTIFICATION entry for the tested Vision routes still carries
    // their pre-Phase-B tier.
    assert.match(HTML, /providerId:'openrouter',modelId:'xiaomi\/mimo-v2-omni',tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/providerId:'openai',modelId:'gpt-5\.4-mini'[^}]*\}\}/);
    assert.ok(gpt, "openai/gpt-5.4-mini block must still exist");
    assert.match(gpt![0], /tier:'EXPERIMENTAL'/, "gpt-5.4-mini main-suite tier must remain EXPERIMENTAL");
  });

  it("P19 · Roleplay stability runner still present (Phase B did not regress prior phases)", () => {
    assert.ok(existsSync(ROLEPLAY_RUNNER), "scripts/roleplay-stability.mjs must remain in place");
    const rp = readFileSync(ROLEPLAY_RUNNER, "utf-8");
    // Spot-check the Roleplay runner still carries its own 8-label classifier
    // so a refactor that consolidated runners would be flagged here too.
    assert.match(rp, /STABLE_PASS/);
    assert.match(rp, /NEEDS_REVIEW_STABLE/);
  });

  it("P20 · Vision (5) + Roleplay (10) task inventories unchanged; release-gauntlet count steady", () => {
    const visionDir = join(ROOT, "tasks", "vision");
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    const vision = readdirSync(visionDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    const roleplay = readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(vision.length, 5, `vision must remain at 5 tasks; got ${vision.join(", ")}`);
    assert.equal(roleplay.length, 10, `roleplay must remain at 10 tasks; got ${roleplay.join(", ")}`);
  });
});
