/**
 * Crucible — Vision Phase 13-B: prefer MiMo-V2.5 as Vision daily-driver
 * candidate, keep Omni as legacy/proven fallback (offline tests).
 *
 * 16 deterministic offline assertions covering:
 *   - VISION_ROUTE_RECOMMENDATIONS top-level constant with
 *     preferredDailyDriver + legacyFallbacks, each carrying the
 *     three doctrine flags as literal false
 *   - UI Vision panel exposes "PREFERRED DAILY-DRIVER CANDIDATE" +
 *     "LEGACY / PROVEN FALLBACK" blocks, with v2.5 preferred and
 *     Omni still visible
 *   - no "certified replacement" wording (or variants) anywhere in
 *     the recommendation surface
 *   - docs example commands prefer xiaomi/mimo-v2.5 and keep
 *     xiaomi/mimo-v2-omni as a labelled legacy fallback
 *   - scripts/vision-smoke.mjs default --model is xiaomi/mimo-v2.5
 *   - Omni stays in MODEL_CERTIFICATION.models[] at its prior tier;
 *     no tier change for any tested route
 *   - certified-models.json has no v2.5/gpt-5.4-mini Vision-promotion
 *     entry
 *   - Vision still excluded from leaderboard + Roleplay baseline
 *     unchanged
 *   - Capability doctrine evaluator gates + task inventory steady
 *
 * No provider calls. No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { VISION_GATES } from "../core/capability-certification.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "vision-smoke.mjs"), "utf-8");

function extractRecommendationBlock(): string {
  // Pull the body of the VISION_ROUTE_RECOMMENDATIONS object literal
  // out of the HTML source for content assertions. We match from the
  // declaration line to the closing `};` of the literal — the constant
  // is a single top-level declaration so we can rely on
  // first-matching-close behaviour with a hand-built scanner.
  const open = HTML.indexOf("const VISION_ROUTE_RECOMMENDATIONS");
  assert.notEqual(open, -1, "VISION_ROUTE_RECOMMENDATIONS declaration missing");
  // Find the first `={` and then walk braces.
  const eq = HTML.indexOf("={", open);
  assert.notEqual(eq, -1);
  let depth = 0;
  let i = eq + 1; // points at the `{`
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return HTML.slice(open, i);
}

describe("Vision Phase 13-B · prefer MiMo-V2.5 as Vision daily-driver candidate (offline)", () => {
  // -------- recommendation metadata --------

  it("P1 · VISION_ROUTE_RECOMMENDATIONS constant exists as a top-level declaration", () => {
    assert.match(HTML, /^const VISION_ROUTE_RECOMMENDATIONS\s*=\s*\{/m);
  });

  it("P2 · preferredDailyDriver targets openrouter / xiaomi/mimo-v2.5 with the validated daily-driver verdict", () => {
    const body = extractRecommendationBlock();
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*provider:\s*'openrouter'/s);
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*model:\s*'xiaomi\/mimo-v2\.5'/s);
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*verdict:\s*'DAILY_DRIVER_CANDIDATE_VALIDATED'/s);
  });

  it("P3 · preferredDailyDriver.affectsLeaderboard is literal false", () => {
    const body = extractRecommendationBlock();
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*affectsLeaderboard:\s*false/s);
  });

  it("P4 · preferredDailyDriver.affectsCertification is literal false", () => {
    const body = extractRecommendationBlock();
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*affectsCertification:\s*false/s);
  });

  it("P5 · preferredDailyDriver.promotionExecuted is literal false", () => {
    const body = extractRecommendationBlock();
    assert.match(body, /preferredDailyDriver:\s*\{[^}]*promotionExecuted:\s*false/s);
  });

  it("P6 · legacyFallbacks array includes xiaomi/mimo-v2-omni with the same three literal-false doctrine flags", () => {
    const body = extractRecommendationBlock();
    assert.match(body, /legacyFallbacks:\s*\[/);
    // Find the legacyFallbacks entry block — single-entry array so a
    // straightforward substring scan is enough.
    // body is the literal up to and including the outer `}` (no
    // trailing `;`). Locate the legacyFallbacks bracket pair and walk
    // the matching brackets manually to handle nested objects.
    const startIdx = body.indexOf("legacyFallbacks:");
    assert.notEqual(startIdx, -1, "legacyFallbacks key must exist");
    const openIdx = body.indexOf("[", startIdx);
    assert.notEqual(openIdx, -1, "legacyFallbacks opening bracket must exist");
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < body.length; i++) {
      if (body[i] === "[") depth++;
      else if (body[i] === "]") { depth--; if (depth === 0) { closeIdx = i; break; } }
    }
    assert.notEqual(closeIdx, -1, "legacyFallbacks closing bracket must exist");
    const legacy = body.slice(openIdx + 1, closeIdx);
    assert.match(legacy, /model:\s*'xiaomi\/mimo-v2-omni'/);
    assert.match(legacy, /promotionExecuted:\s*false/);
    assert.match(legacy, /affectsLeaderboard:\s*false/);
    assert.match(legacy, /affectsCertification:\s*false/);
  });

  // -------- UI blocks --------

  it("P7 · Vision panel exposes a PREFERRED DAILY-DRIVER CANDIDATE block targeting xiaomi/mimo-v2.5", () => {
    assert.match(HTML, /PREFERRED DAILY-DRIVER CANDIDATE[\s\S]{0,400}xiaomi\/mimo-v2\.5/);
    assert.match(HTML, /PREFERRED DAILY-DRIVER CANDIDATE[\s\S]{0,800}DAILY_DRIVER_CANDIDATE_VALIDATED/);
  });

  it("P8 · Vision panel exposes a LEGACY / PROVEN FALLBACK block targeting xiaomi/mimo-v2-omni", () => {
    assert.match(HTML, /LEGACY \/ PROVEN FALLBACK[\s\S]{0,400}xiaomi\/mimo-v2-omni/);
    // The fallback block must NOT say "certified" without negation
    // (handled in the wider P9 check).
  });

  it("P9 · neither recommendation block contains 'certified replacement' (or 'release-certified replacement')", () => {
    // The two blocks live inside renderVisionLanePanel. We're looking
    // at the literal copy. Phase 13-A test (P8) already covered the
    // report; this one covers the UI surface specifically.
    const panelStart = HTML.indexOf("renderVisionLanePanel");
    assert.notEqual(panelStart, -1);
    const panel = HTML.slice(panelStart, panelStart + 30000);
    assert.doesNotMatch(panel, /certified replacement/i);
    assert.doesNotMatch(panel, /release-?certified replacement/i);
    assert.doesNotMatch(panel, /certified preferred/i);
    assert.doesNotMatch(panel, /auto-?default/i);
  });

  // -------- docs --------

  it("P10 · docs example commands prefer xiaomi/mimo-v2.5 and keep xiaomi/mimo-v2-omni as a labelled legacy fallback", () => {
    // The first --model example in the rerun section must reference v2.5.
    const rerun = DOC.split("## How to rerun the smoke")[1] || "";
    assert.ok(rerun.length > 0, "rerun section must exist");
    const firstModel = rerun.match(/--model\s+(\S+)/);
    assert.ok(firstModel, "rerun section must include at least one --model command");
    assert.equal(firstModel![1], "xiaomi/mimo-v2.5", `first --model in docs rerun section must be xiaomi/mimo-v2.5; got ${firstModel![1]}`);
    // v2-omni must remain as a documented legacy fallback in the same
    // section (so operators can rerun against it).
    assert.match(rerun, /--model\s+xiaomi\/mimo-v2-omni/);
    assert.match(rerun, /legacy/i);
  });

  it("P11 · scripts/vision-smoke.mjs default --model is xiaomi/mimo-v2.5", () => {
    assert.match(SMOKE_SRC, /arg\("--model",\s*"xiaomi\/mimo-v2\.5"\)/);
  });

  // -------- regression guards --------

  it("P12 · xiaomi/mimo-v2-omni is still present in MODEL_CERTIFICATION.models[] with unchanged tier", () => {
    // Exactly one certification row, tier preserved.
    const omniCert = HTML.match(/modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'([^']+)'/g) || [];
    assert.equal(omniCert.length, 1, `Omni must have exactly one certification entry; got ${omniCert.length}`);
    assert.match(omniCert[0], /tier:'PROVIDER_TESTED'/);
  });

  it("P13 · MODEL_CERTIFICATION.models[].tier unchanged for every Vision-tested route post-Phase-13-B", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL", "gpt-5.4-mini Vision-experimental tier must remain unchanged");
  });

  it("P14 · certified-models.json has no v2.5 or gpt-5.4-mini Vision-promotion entry added by Phase 13-B", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models));
    for (const m of certified.models as Array<{ modelId: string; provider?: string; campaign?: string }>) {
      const id = `${m.provider}/${m.modelId}`;
      // gpt-5.4-mini was added by Phase 9 as an experimental Vision
      // route only; it must not appear in the certified registry.
      assert.notEqual(id, "openai/gpt-5.4-mini", "gpt-5.4-mini must not appear in certified-models.json after Phase 13-B");
      // Phase 13-B must not have stamped a vision-13b campaign onto
      // any entry.
      if (typeof m.campaign === "string") {
        assert.doesNotMatch(m.campaign, /vision-13b|phase-?13-?b/i, `certified entry has Phase 13-B campaign stamp on ${id}; recommendations must not write here`);
      }
    }
  });

  it("P15 · Vision tab still contributes zero score families + Roleplay baseline unchanged", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay remains experimental/);
  });

  it("P16 · Capability doctrine gates + task inventory steady (23 / 5 / 10)", () => {
    // Doctrine evaluator must be byte-identical at the gate level.
    const stableDisallowed = [...VISION_GATES.STABLE.disallowedRecurringAttributions].sort();
    assert.deepEqual(stableDisallowed, ["CONFIG", "FIXTURE", "PROVIDER", "SCORER"]);
    assert.equal(VISION_GATES.STABLE.minStablePassRate, 0.80);
    assert.equal(VISION_GATES.STABLE.minRepeatRuns, 3);
    // Inventory.
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.equal(taskFams.length, 23, `task family count must remain 23; got ${taskFams.length}`);
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 5);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
  });
});
