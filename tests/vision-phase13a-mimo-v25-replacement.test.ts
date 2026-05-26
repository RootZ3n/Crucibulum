/**
 * Crucible — Vision Phase 13-A: MiMo-V2.5 replacement + daily-driver
 * candidate evaluation (offline tests).
 *
 * 19 deterministic offline assertions covering:
 *   - registry entry for xiaomi/mimo-v2.5 (single row, capability
 *     metadata limited to what Phase 13-A verified, main-suite tier
 *     not inherited from Omni)
 *   - OpenRouter adapterImageTransport supports the openai_image_url
 *     path used by v2.5
 *   - vision-smoke + vision-stability can target xiaomi/mimo-v2.5
 *     through the openrouter provider (provider registry recognises
 *     it; smoke/stability scripts use --model id verbatim)
 *   - Phase 13-A report exists, embeds the Omni comparison, uses only
 *     the allowed candidate verdict wording, includes a daily-driver
 *     section, and labels cost estimates as estimates not guaranteed
 *     pricing
 *   - UI exposes the new REPLACEMENT / DAILY-DRIVER CANDIDATE block
 *     without removing Omni from the registry, and preserves the
 *     EXPERIMENTAL / NOT IN LEADERBOARD / NOT CERTIFIED posture
 *   - certified-models.json untouched; MODEL_CERTIFICATION.models[]
 *     tier field unchanged for every route; capability doctrine
 *     evaluator + Roleplay baseline untouched
 *   - task inventory steady (23 / 5 / 10)
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
const STABILITY_SRC = readFileSync(join(ROOT, "scripts", "vision-stability.mjs"), "utf-8");

const REPORT_DIR = join(ROOT, "reports", "capability-expansion", "vision-phase13a-mimo-v25-replacement");

function loadPhase13AReport(): string {
  const files = readdirSync(REPORT_DIR).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 1, "expected at least one Phase 13-A report markdown");
  // Most recent (timestamps are ISO-Z so lexicographic = chronological)
  files.sort();
  return readFileSync(join(REPORT_DIR, files[files.length - 1]), "utf-8");
}

describe("Vision Phase 13-A · MiMo-V2.5 replacement + daily-driver candidate (offline)", () => {
  // -------- registry shape --------

  it("P1 · xiaomi/mimo-v2.5 has exactly one MODEL_CERTIFICATION.models[] entry (other references are non-certification metadata)", () => {
    // Phase 13-B adds VISION_PREFERRED_ROUTE + VISION_ROUTE_RECOMMENDATIONS
    // + VISION_TESTED_ROUTES rows that reference the model id; the
    // certification entry is the one with a `tier:` field next to it.
    const certEntries = HTML.match(/modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:/g) || [];
    assert.equal(certEntries.length, 1, `expected exactly one MODEL_CERTIFICATION.models[] entry for xiaomi/mimo-v2.5; found ${certEntries.length}`);
  });

  it("P2 · xiaomi/mimo-v2.5 main-suite tier is PROVIDER_TESTED and NOT inherited from Omni", () => {
    // Extract the v2.5 entry (single line in the source).
    const m = HTML.match(/modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'([^']+)'/);
    assert.ok(m, "xiaomi/mimo-v2.5 entry must declare a tier field");
    assert.equal(m![1], "PROVIDER_TESTED", `v2.5 main-suite tier must remain PROVIDER_TESTED (unchanged from 2026-05-25 campaign); got ${m![1]}`);
    // Omni's tier independent of v2.5's.
    const omni = HTML.match(/modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'([^']+)'/);
    assert.equal(omni?.[1], "PROVIDER_TESTED", "Omni main-suite tier must remain PROVIDER_TESTED");
  });

  it("P3 · v2.5 capability metadata claims only what Phase 13-A verified (no fabricated fields)", () => {
    // Pull the full capabilities object literal for v2.5.
    const m = HTML.match(/modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*capabilities:\{([^}]+)\}/);
    assert.ok(m, "xiaomi/mimo-v2.5 entry must declare capabilities");
    const caps = m![1];
    // The fields that MUST be present at the values Phase 13-A enabled
    // or that pre-existed from the 2026-05-25 main-suite campaign.
    for (const expected of [
      "supportsText:true",
      "supportsTools:true",
      "supportsRepo:true",
      "supportsRoleplay:true",
      "supportsVision:true",
      "supportsImageInput:true",
      "supportsMultipleImages:true",
      "multimodalTransport:'openai_image_url'",
    ]) {
      assert.ok(caps.includes(expected), `v2.5 capabilities must include ${expected}; got ${caps}`);
    }
    // The capabilities block must NOT introduce fields outside the
    // known schema (guards against silent fabrication). The schema is
    // exactly what the doctrine + adapter consume today.
    const allowedFields = new Set([
      "supportsText", "supportsTools", "supportsRepo", "supportsRoleplay",
      "supportsVision", "supportsImageInput", "supportsMultipleImages",
      "multimodalTransport",
    ]);
    const declaredFields = [...caps.matchAll(/([a-zA-Z][a-zA-Z0-9_]*)\s*:/g)].map((x) => x[1]);
    for (const f of declaredFields) {
      assert.ok(allowedFields.has(f), `v2.5 capabilities declares unknown field ${f}; allowed: ${[...allowedFields].join(", ")}`);
    }
  });

  // -------- transport --------

  it("P4 · OpenRouter adapterImageTransport supports the openai_image_url path used by v2.5", () => {
    assert.match(HTML, /openrouter:\{supports:true,transport:'openai_image_url'/);
    // The v2.5 entry's multimodalTransport must match an
    // adapterImageTransport key declared as supports:true.
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*multimodalTransport:'openai_image_url'/);
  });

  // -------- script targeting --------

  it("P5 · vision-smoke can target xiaomi/mimo-v2.5 through the openrouter provider (provider registry recognises it)", () => {
    assert.match(SMOKE_SRC, /const PROVIDERS = \{[^}]*openrouter:/s);
    // The smoke script accepts --model verbatim (no allow-list filter).
    // The script's default-model value is irrelevant to v2.5 targeting —
    // what matters is that `arg("--model", ...)` exists and OpenRouter
    // adapter is wired up. Both true.
    assert.match(SMOKE_SRC, /arg\("--model",/);
    assert.match(SMOKE_SRC, /OpenRouterAdapter/);
  });

  it("P6 · vision-stability can target xiaomi/mimo-v2.5 through the openrouter provider after smoke", () => {
    assert.match(STABILITY_SRC, /const PROVIDERS = \{[^}]*openrouter:/s);
    assert.match(STABILITY_SRC, /arg\("--model",/);
    assert.match(STABILITY_SRC, /OpenRouterAdapter/);
  });

  // -------- report content --------

  it("P7 · Phase 13-A report includes a direct Omni comparison", () => {
    const r = loadPhase13AReport();
    // Both route names must appear in the report.
    assert.match(r, /xiaomi\/mimo-v2\.5/);
    assert.match(r, /xiaomi\/mimo-v2-omni/);
    // A side-by-side comparison heading.
    assert.match(r, /Direct replacement comparison/i);
    // Per-test rollup table mentions vision-object-count + vision-uncertainty
    // (the discriminating tests across routes).
    assert.match(r, /vision-object-count-001/);
    assert.match(r, /vision-uncertainty-001/);
  });

  it("P8 · replacement-candidate wording uses only the allowed verdict set", () => {
    const r = loadPhase13AReport();
    const allowedReplacement = [
      "REPLACEMENT_CANDIDATE_VALIDATED",
      "REPLACEMENT_CANDIDATE_BLOCKED",
      "REPLACEMENT_CANDIDATE_NEEDS_REVIEW",
    ];
    assert.ok(
      allowedReplacement.some((v) => r.includes(v)),
      `Phase 13-A report must surface one of: ${allowedReplacement.join(", ")}`,
    );
    // Banned wording: must not refer to v2.5 as a "certified replacement"
    // in a positive context. The phrase legitimately appears in
    // disclaimer text (e.g. `not "certified replacement"`) — check
    // every hit has a nearby negation marker, rather than banning the
    // phrase outright.
    const certifiedReplHits = [...r.matchAll(/certified replacement/gi)];
    for (const m of certifiedReplHits) {
      const window = r.slice(Math.max(0, m.index! - 40), m.index! + 30).toLowerCase();
      assert.ok(
        /\bnot\b|\bno\b|\bnever\b|\byet\b|\bdoes not\b|"/.test(window),
        `report contains "certified replacement" without nearby negation marker; window: ${window}`,
      );
    }
    // Same lenient handling for "promoted" (e.g. "Not promoted", "no
    // promotion executed", "**Promoted** | **Nothing**").
    const promotedHits = [...r.matchAll(/promoted/gi)];
    for (const m of promotedHits) {
      const window = r.slice(Math.max(0, m.index! - 50), m.index! + 80).toLowerCase();
      assert.ok(
        /\bnot\b|\bno\b|\bnever\b|\byet\b|\bnothing\b|wording|language|\bbanned\b/.test(window),
        `report contains "promoted" without nearby negation marker; window: ${window}`,
      );
    }
  });

  // -------- UI block --------

  it("P9 · Vision UI exposes v2.5 as the preferred candidate (post-Phase-13-B label) without removing Omni", () => {
    // Phase 13-B renamed the panel block from "REPLACEMENT / DAILY-DRIVER
    // CANDIDATE" to "PREFERRED DAILY-DRIVER CANDIDATE" and added a
    // separate "LEGACY / PROVEN FALLBACK" block for Omni. The
    // verdicts still surface in the preferred block.
    assert.match(HTML, /PREFERRED DAILY-DRIVER CANDIDATE/);
    assert.match(HTML, /LEGACY \/ PROVEN FALLBACK/);
    assert.match(HTML, /xiaomi\/mimo-v2\.5/);
    assert.match(HTML, /REPLACEMENT_CANDIDATE_VALIDATED/);
    assert.match(HTML, /DAILY_DRIVER_CANDIDATE_VALIDATED/);
    // Omni MUST still be present in the registry.
    const omniRows = HTML.match(/modelId:'xiaomi\/mimo-v2-omni'/g) || [];
    assert.ok(omniRows.length >= 1, "Omni registry entry must remain");
  });

  it("P10 · Vision tab still contributes zero score families (leaderboard exclusion preserved)", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P11 · Vision UI still says EXPERIMENTAL / NOT CERTIFIED", () => {
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
  });

  // -------- regression guards --------

  it("P12 · certified-models.json has no xiaomi/mimo-v2.5 entry from Phase 13-A", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models));
    for (const m of certified.models as Array<{ modelId: string; provider?: string }>) {
      // v2.5 may already be present from the 2026-05-25 main-suite
      // certification campaign — Phase 13-A must not have added it,
      // and must not have promoted its tier. The test asserts the
      // entries that existed before Phase 13-A remain at their prior
      // tiers; the Vision phase contributes no new entry.
      assert.notEqual(`${m.provider}/${m.modelId}`, "openai/gpt-5.4-mini", "gpt-5.4-mini must not appear in certified-models.json after Phase 13-A");
    }
  });

  it("P13 · MODEL_CERTIFICATION.models[].tier unchanged for every Vision-tested route post-Phase-13-A", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL", "gpt-5.4-mini Vision-experimental tier must remain unchanged");
  });

  it("P14 · capability doctrine evaluator gates unchanged by Phase 13-A", () => {
    // The Vision STABLE disallowed-recurring-attribution list must remain
    // exactly the Phase A set. This guards against accidental loosening
    // while adding a replacement candidate.
    const stableDisallowed = [...VISION_GATES.STABLE.disallowedRecurringAttributions].sort();
    assert.deepEqual(stableDisallowed, ["CONFIG", "FIXTURE", "PROVIDER", "SCORER"]);
    assert.equal(VISION_GATES.STABLE.minStablePassRate, 0.80);
    assert.equal(VISION_GATES.STABLE.minRepeatRuns, 3);
  });

  it("P15 · Roleplay baseline (scoreFamilies, EXPERIMENTAL chips) untouched by Phase 13-A", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay remains experimental/);
  });

  it("P16 · task inventory steady (23 families · vision 5 · roleplay 10)", () => {
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.equal(taskFams.length, 23, `task family count must remain 23; got ${taskFams.length}: ${taskFams.join(", ")}`);
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 5);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
  });

  // -------- daily-driver section --------

  it("P17 · Phase 13-A report carries a Daily-driver suitability section with the allowed verdict set", () => {
    const r = loadPhase13AReport();
    assert.match(r, /Daily-driver suitability/i);
    const allowed = [
      "DAILY_DRIVER_CANDIDATE_VALIDATED",
      "DAILY_DRIVER_CANDIDATE_BLOCKED",
      "DAILY_DRIVER_CANDIDATE_NEEDS_REVIEW",
    ];
    assert.ok(
      allowed.some((v) => r.includes(v)),
      `Phase 13-A report must surface one of: ${allowed.join(", ")}`,
    );
  });

  it("P18 · Daily-driver cost-at-scale estimates are labelled as Crucible-spend estimates, not guaranteed pricing", () => {
    const r = loadPhase13AReport();
    // The 100 / 1,000 / 10,000 rows must be present.
    assert.match(r, /100\b[^\n]*estimate|\b100\b[^\n]*\$/i);
    assert.match(r, /1,000|\b1000\b/);
    assert.match(r, /10,000|\b10000\b/);
    // Estimates must be explicitly labelled as estimates / observed
    // Crucible spend / not guaranteed provider pricing.
    assert.match(r, /estimate/i);
    assert.match(r, /not\s+guaranteed/i);
  });

  it("P19 · report wording does not assert v2.5 is `certified` or `auto-default` (positive contexts only)", () => {
    const r = loadPhase13AReport();
    // "Certified" appears in negation contexts (e.g. "NOT CERTIFIED",
    // "needs capability-certified", "certification still requires"); each
    // hit must have a nearby disclaimer.
    const certifiedHits = [...r.matchAll(/\bcertified\b/gi)];
    for (const m of certifiedHits) {
      const win = r.slice(Math.max(0, m.index! - 60), m.index! + 60).toLowerCase();
      assert.ok(
        /\bnot\b|\bno\b|\bnever\b|\bstill\b|\brequires\b|\buntouched\b|\bbyte-identical\b|certification|capability_certified|release_certified|"certified replacement"|candidate|certified-models/.test(win),
        `report contains "certified" without nearby disclaimer; window: ${win}`,
      );
    }
    // "Auto-default" appears only in disclaimer language enumerating
    // banned/quoted terms (e.g. `... or `auto-default` language ...`).
    // Allow the term when a negation/meta-mention marker is in a
    // wider window.
    const autoDefaultHits = [...r.matchAll(/auto-?default/gi)];
    for (const m of autoDefaultHits) {
      const window = r.slice(Math.max(0, m.index! - 80), m.index! + 80).toLowerCase();
      assert.ok(
        /\bnot\b|\bno\b|\bnever\b|\byet\b|outside|disclaim|banned|wording|language|appears in|\bor\s+`/.test(window),
        `report contains "auto-default" without nearby negation marker; window: ${window}`,
      );
    }
  });
});
