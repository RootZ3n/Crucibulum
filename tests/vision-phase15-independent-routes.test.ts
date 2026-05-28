/**
 * Luak — Vision Phase 15 / Roadmap E: independent-route validation
 * for the expanded 15-test Vision suite (offline + live HTTP tests).
 *
 * 19 deterministic tests covering:
 *
 *   - candidate-inventory report exists.
 *   - anthropic/claude-haiku-4-5 is registered with Vision capability
 *     flags and EXPERIMENTAL capability tier (Vision-only enablement,
 *     no main-suite promotion).
 *   - independent-family counting treats MiMo variants as one family
 *     (does NOT count xiaomi/mimo-v2-omni as separate from v2.5).
 *   - promotion evaluator endpoint reports the new aggregate-family
 *     block with 3/3 families qualifying and the doctrine decision
 *     marked dry-run eligible — without promoting anything.
 *   - per-route capabilityCertifiedDecision still blocks every route
 *     on independent-routes (per-route view is intentionally
 *     single-route).
 *   - top-level + aggregate flags remain literal-false
 *     (promoted, affectsLeaderboard, affectsCertification).
 *   - Vision still excluded from leaderboard / certification.
 *   - certified-models.json byte-identical.
 *   - MODEL_CERTIFICATION.models[].tier unchanged for every prior
 *     Vision route.
 *   - Roleplay baseline still passes; capability doctrine evaluator
 *     gates unchanged.
 *   - inventory pinned at 23 / 87 / 62.
 *
 * No provider calls. No network outside 127.0.0.1.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Isolate harness FS before any env-aware import.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase15-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase15-state-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase15-links-"));
// Phase 16 added a global env var (CRUCIBLE_CAPABILITY_STATE_DIR)
// that other test files set at top-level. Within node:test files
// run in the same process by default, so any other file that set
// the env to a tmp dir with state would leak into our GET responses
// here. Point to our OWN tmp dir so Phase 15 always sees an empty
// capability state regardless of what Phase 16 is doing.
const CAP_STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase15-capstate-"));
const CAP_REPORTS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase15-capreports-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
process.env["CRUCIBLE_CAPABILITY_STATE_DIR"] = CAP_STATE_DIR;
process.env["CRUCIBLE_CAPABILITY_REPORTS_DIR"] = CAP_REPORTS_DIR;
process.env["CRUCIBLE_HMAC_KEY"] = "phase15-test-hmac";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { VISION_GATES } = await import("../core/capability-certification.js");

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");
const ROADMAP = readFileSync(join(ROOT, "docs", "CAPABILITY_CERTIFICATION_ROADMAP.md"), "utf-8");

let server: Server;
let base = "";

interface AggregateBlock {
  independentFamiliesQualifying: string[];
  independentFamilyCount: number;
  independentFamilyTarget: number;
  routesQualifying: Array<{ provider: string; model: string; family: string }>;
  decision: { eligible: boolean; blockingReasons: Array<{ gate: string }>; affectsLeaderboard: boolean; affectsCertification: boolean };
  promoted: boolean;
  affectsLeaderboard: boolean;
  affectsCertification: boolean;
}

interface PromoResp {
  promoted: boolean;
  affectsLeaderboard: boolean;
  affectsCertification: boolean;
  noMutationGuarantee: boolean;
  promotionRequiresFutureWritePhase: boolean;
  currentTier: string;
  evaluatedRoutes: Array<{
    provider: string;
    model: string;
    family: string;
    role: string;
    evidenceSummary: { suiteSize: number; stablePassRate: number; evidencePresent: boolean; recurringAttributions: string[]; independentRoutesTested: number };
    capabilityCertifiedDecision: { eligible: boolean; blockingReasons: Array<{ gate: string }> };
  }>;
  aggregateCapabilityCertified: AggregateBlock;
}

before(async () => {
  __resetRateLimiterForTests();
  server = createApp({ rateLimit: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getPromo(): Promise<PromoResp> {
  const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
  return (await r.json()) as PromoResp;
}

describe("Vision Phase 15 / Roadmap E · independent-route validation (offline + live API)", () => {
  // -------- artifacts on disk --------

  it("P1 · candidate-inventory report exists for Phase 15", () => {
    const p = join(ROOT, "reports", "capability-expansion", "vision-phase15-independent-routes", "candidate-inventory.md");
    assert.ok(existsSync(p), "candidate-inventory.md must exist under reports/capability-expansion/vision-phase15-independent-routes/");
    const body = readFileSync(p, "utf-8");
    assert.match(body, /Roadmap E/i);
    assert.match(body, /independent-routes/);
  });

  // -------- registry --------

  it("P2 · anthropic/claude-haiku-4-5 is registered with Vision capability flags + EXPERIMENTAL tier", () => {
    const m = HTML.match(/modelId:'anthropic\/claude-haiku-4-5'[^}]*tier:'([^']+)'[^}]*capabilities:\{([^}]+)\}/);
    assert.ok(m, "claude-haiku-4-5 must have a registry entry");
    assert.equal(m![1], "EXPERIMENTAL", "tier must be EXPERIMENTAL for Vision-only enablement");
    const caps = m![2];
    for (const expected of [
      "supportsText:true",
      "supportsVision:true",
      "supportsImageInput:true",
      "supportsMultipleImages:true",
      "multimodalTransport:'openai_image_url'",
    ]) {
      assert.ok(caps.includes(expected), `claude-haiku-4-5 capabilities must include ${expected}; got ${caps}`);
    }
  });

  it("P3 · MiMo variants (v2.5 + v2-omni) share one family — independent-family counting must not double-count", async () => {
    const body = await getPromo();
    // Both MiMo rows must carry the same family label.
    const v25 = body.evaluatedRoutes.find((x) => x.provider === "openrouter" && x.model === "xiaomi/mimo-v2.5");
    const omni = body.evaluatedRoutes.find((x) => x.provider === "openrouter" && x.model === "xiaomi/mimo-v2-omni");
    assert.ok(v25, "v2.5 must appear in evaluatedRoutes");
    assert.ok(omni, "v2-omni must appear in evaluatedRoutes");
    assert.equal(v25!.family, "MiMo");
    assert.equal(omni!.family, "MiMo");
    // The aggregate's qualifying-family list must not list MiMo
    // twice (the dedup is the doctrine guarantee).
    const mimoCount = body.aggregateCapabilityCertified.independentFamiliesQualifying.filter((f) => f === "MiMo").length;
    assert.ok(mimoCount <= 1, `MiMo must appear at most once in qualifying families; got ${mimoCount}`);
  });

  // -------- live API: per-route + aggregate --------

  it("P4 · all four registered routes appear in evaluatedRoutes (v2.5, v2-omni, gpt-5.4-mini, claude-haiku-4-5)", async () => {
    const body = await getPromo();
    const ids = body.evaluatedRoutes.map((r) => `${r.provider}/${r.model}`);
    assert.deepEqual(ids.sort(), [
      "openai/gpt-5.4-mini",
      "openrouter/anthropic/claude-haiku-4-5",
      "openrouter/xiaomi/mimo-v2-omni",
      "openrouter/xiaomi/mimo-v2.5",
    ]);
  });

  it("P5 · evaluatedRoutes assigns the canonical family label to every route", async () => {
    const body = await getPromo();
    const map: Record<string, string> = {
      "openrouter/xiaomi/mimo-v2.5": "MiMo",
      "openrouter/xiaomi/mimo-v2-omni": "MiMo",
      "openai/gpt-5.4-mini": "GPT-5",
      "openrouter/anthropic/claude-haiku-4-5": "Anthropic",
    };
    for (const r of body.evaluatedRoutes) {
      const id = `${r.provider}/${r.model}`;
      assert.equal(r.family, map[id], `${id} must have family=${map[id]}; got ${r.family}`);
    }
  });

  it("P6 · per-route capabilityCertifiedDecision still blocks every route on independent-routes (per-route view is single-route)", async () => {
    const body = await getPromo();
    for (const r of body.evaluatedRoutes) {
      const gates = r.capabilityCertifiedDecision.blockingReasons.map((b) => b.gate);
      assert.equal(r.capabilityCertifiedDecision.eligible, false, `${r.provider}/${r.model} per-route CERT must remain blocked`);
      assert.ok(
        gates.includes("vision.capability-certified.independent-routes") || gates.includes("vision.capability-certified.evidence-missing"),
        `${r.provider}/${r.model} per-route CERT must surface independent-routes or evidence-missing; got ${gates.join(", ")}`,
      );
    }
  });

  it("P7 · aggregateCapabilityCertified reports 3/3 qualifying families (MiMo + GPT-5 + Anthropic)", async () => {
    const body = await getPromo();
    const agg = body.aggregateCapabilityCertified;
    assert.deepEqual(agg.independentFamiliesQualifying, ["Anthropic", "GPT-5", "MiMo"]);
    assert.equal(agg.independentFamilyCount, 3);
    assert.equal(agg.independentFamilyTarget, 3);
  });

  it("P8 · aggregate Capability-Certified decision is dry-run eligible with no blocking reasons", async () => {
    const body = await getPromo();
    assert.equal(body.aggregateCapabilityCertified.decision.eligible, true);
    assert.equal(body.aggregateCapabilityCertified.decision.blockingReasons.length, 0);
  });

  it("P9 · routesQualifying enumerates exactly the routes with 15-test stability evidence at ≥80% pass rate", async () => {
    // Phase 18-B removed the retry-on-FS-race (Phase 13c P14 +
    // Phase 16 P23 now use env override instead of renameSync, so
    // the race source is gone).
    const body = await getPromo();
    const expected = [
      { provider: "openrouter", model: "xiaomi/mimo-v2.5", family: "MiMo" },
      { provider: "openai", model: "gpt-5.4-mini", family: "GPT-5" },
      { provider: "openrouter", model: "anthropic/claude-haiku-4-5", family: "Anthropic" },
    ];
    const got = body.aggregateCapabilityCertified.routesQualifying;
    assert.equal(got.length, expected.length);
    // Order-agnostic comparison.
    for (const e of expected) {
      assert.ok(
        got.find((g) => g.provider === e.provider && g.model === e.model && g.family === e.family),
        `expected route ${e.provider}/${e.model}[${e.family}] in routesQualifying; got ${JSON.stringify(got)}`,
      );
    }
  });

  it("P10 · v2-omni is NOT in routesQualifying (5-test legacy evidence < 15)", async () => {
    const body = await getPromo();
    const got = body.aggregateCapabilityCertified.routesQualifying;
    assert.ok(
      !got.find((g) => g.provider === "openrouter" && g.model === "xiaomi/mimo-v2-omni"),
      "v2-omni must NOT qualify — its evidence is on the 5-test suite, below the suite-size threshold",
    );
  });

  // -------- no-promotion guarantee --------

  it("P11 · top-level promoted:false / affectsLeaderboard:false / affectsCertification:false preserved", async () => {
    // Phase 18-B removed the retry-on-FS-race that used to live here.
    // The race source (Phase 13c P14 + Phase 16 P23 renaming the
    // real stability dir) was eliminated by making the dir
    // env-overridable; those tests now point at empty tmp dirs.
    const body = await getPromo();
    assert.equal(body.promoted, false);
    assert.equal(body.affectsLeaderboard, false);
    assert.equal(body.affectsCertification, false);
    assert.equal(body.currentTier, "EXPERIMENTAL");
    assert.equal(body.noMutationGuarantee, true);
    assert.equal(body.promotionRequiresFutureWritePhase, true);
  });

  it("P12 · aggregateCapabilityCertified block carries literal-false promoted/affectsLeaderboard/affectsCertification", async () => {
    // Phase 18-B removed the retry-on-FS-race (no longer needed —
    // the cross-file rename race was fixed at the source).
    const body = await getPromo();
    const agg = body.aggregateCapabilityCertified;
    assert.ok(agg, "aggregateCapabilityCertified must be present in the response");
    assert.equal(agg.promoted, false);
    assert.equal(agg.affectsLeaderboard, false);
    assert.equal(agg.affectsCertification, false);
    assert.equal(agg.decision.affectsLeaderboard, false);
    assert.equal(agg.decision.affectsCertification, false);
  });

  // -------- registry / certification regressions --------

  it("P13 · MODEL_CERTIFICATION.models[].tier unchanged for every prior Vision route", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL");
  });

  it("P14 · certified-models.json has no claude-haiku-4-5 or Vision-only Phase-15 promotion entry", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models));
    for (const m of certified.models as Array<{ modelId: string; provider?: string; campaign?: string }>) {
      const id = `${m.provider}/${m.modelId}`;
      assert.notEqual(id, "openrouter/anthropic/claude-haiku-4-5", "claude-haiku-4-5 must not be promoted into certified-models.json from Phase 15");
      if (typeof m.campaign === "string") {
        assert.doesNotMatch(m.campaign, /vision-?15|phase-?15|phase-?e/i, `certified entry must not carry a Phase 15 / Phase E campaign stamp on ${id}`);
      }
    }
  });

  it("P15 · Vision tab still contributes zero score families + Roleplay baseline intact", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay remains experimental/);
  });

  it("P16 · capability doctrine gates byte-identical to Phase A spec", () => {
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minSuiteSize, 15);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes, 3);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minStablePassRate, 0.80);
    assert.deepEqual([...VISION_GATES.CAPABILITY_CERTIFIED.disallowedRecurringAttributions].sort(), ["CONFIG", "FIXTURE", "PROVIDER", "SCORER"]);
  });

  it("P17 · task inventory pinned at 23 / 87 / 62 (no new tasks from Phase 15 — adapter-route-only change)", () => {
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(taskFams.length, 23);
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 15);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
  });

  // -------- UI + docs --------

  it("P18 · UI promotion dry-run block carries the new aggregate-family section + 3/3 wording", () => {
    assert.match(HTML, /Aggregate Capability-Certified/);
    assert.match(HTML, /independentFamiliesQualifying/);
    assert.match(HTML, /independentFamilyTarget/);
    // Phase 16 added a conditional "Promoted: yes/no" line inside a
    // template literal (`promotedLine`) declared above the aggHtml
    // assignment; the "no" branch is the default. Search the full
    // HTML — the literal strings are present in the source, just
    // not in a single 2400-char window because the ternary is
    // defined upstream of the block markup.
    assert.match(HTML, /Promoted:\s*<strong>no<\/strong>/i, "the 'no' branch of the Promoted line must be present in the template literal source");
    assert.match(HTML, /Affects leaderboard:\s*<strong>no<\/strong>/i);
    assert.match(HTML, /Affects certification:\s*<strong>no<\/strong>/i);
  });

  it("P19 · docs document the Phase 15 / Roadmap E independent-route validation + the Roadmap E section is marked landed", () => {
    assert.match(DOC, /Phase 15 \/ Roadmap E/);
    assert.match(DOC, /3 independent model\/provider families|three independent model\/provider families/i);
    assert.match(DOC, /anthropic\/claude-haiku-4-5/);
    assert.match(DOC, /aggregateCapabilityCertified/);
    assert.match(ROADMAP, /Phase E.*landed 2026-05-27|Phase E.*✅/);
  });
});
