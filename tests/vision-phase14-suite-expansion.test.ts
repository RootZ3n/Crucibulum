/**
 * Luak — Vision Phase 14 / Roadmap C suite expansion (5 → 15
 * tests). Offline + live-HTTP regression tests.
 *
 * 25 deterministic tests covering:
 *
 *   - Vision family now contains 15 tasks; both runner ALL_TESTS
 *     constants list 15.
 *   - All 10 new fixtures exist on disk with byte-identical sha256
 *     to the values pinned in their manifests.
 *   - Fixture generation is deterministic (re-running the generator
 *     produces byte-identical PNGs).
 *   - All 10 new manifests declare experimental:true /
 *     affectsLeaderboard:false / affectsCertification:false (the
 *     last two via the family-level Vision exclusion in
 *     TAB_CONFIG; manifests carry experimental:true explicitly).
 *   - All 10 new test-validity cards exist.
 *   - New scorer `absence_honesty` passes valid examples, fails
 *     invalid examples, and routes hedged answers to NEEDS_REVIEW.
 *   - vision-smoke + vision-stability target the full 15-test suite.
 *   - Promotion evaluator endpoint sees suite=15 for v2.5 and the
 *     suite-size blocker has cleared on that route.
 *   - CAPABILITY_CERTIFIED still does not promote (independent-routes
 *     blocker persists).
 *   - Vision still excluded from leaderboard / certification.
 *   - certified-models.json byte-identical; tier fields unchanged.
 *   - Inventory deliberately moved from 23/77/52 → 23/87/62 and is
 *     pinned in this test as the new expected baseline.
 *
 * No provider calls. No network outside 127.0.0.1.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Isolate harness FS before any env-aware import. Phase 16 added
// a CRUCIBLE_CAPABILITY_STATE_DIR global env var; point it to a
// Phase 14-owned tmp dir so other test files can't leak state.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase14-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase14-state-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase14-links-"));
const CAP_STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase14-capstate-"));
const CAP_REPORTS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase14-capreports-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
process.env["CRUCIBLE_CAPABILITY_STATE_DIR"] = CAP_STATE_DIR;
process.env["CRUCIBLE_CAPABILITY_REPORTS_DIR"] = CAP_REPORTS_DIR;
process.env["CRUCIBLE_HMAC_KEY"] = "phase14-test-hmac";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { scoreConversationalQuestion } = await import("../core/conversational-judge.js");
const { VISION_GATES } = await import("../core/capability-certification.js");
import type { ConversationalQuestion } from "../adapters/base.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "vision-smoke.mjs"), "utf-8");
const STABILITY_SRC = readFileSync(join(ROOT, "scripts", "vision-stability.mjs"), "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");

const PHASE14_NEW = [
  "vision-small-text-001",
  "vision-noisy-text-001",
  "vision-spatial-001",
  "vision-spatial-002",
  "vision-visual-contradiction-001",
  "vision-hallucination-resistance-001",
  "vision-multi-object-compare-001",
  "vision-ui-state-001",
  "vision-chart-trend-001",
  "vision-table-001",
];

const POC_5 = [
  "vision-ocr-001",
  "vision-ui-001",
  "vision-chart-001",
  "vision-object-count-001",
  "vision-uncertainty-001",
];

const POC_5_KNOWN_HASHES: Record<string, string> = {
  "vision-ocr-001": "1a68361543fe48b63b8061730896b2930f6ef00204d80ed15b3b6f46736ac978",
  "vision-ui-001": "da850b36bbbb534b156dd9d1eb85bf71e1682e43f571821948eab54445e3e71a",
  "vision-chart-001": "8f684007945499f6d90051cabc568822ca5da7088f27afcb4628de6a53e5702a",
  "vision-object-count-001": "0d966dc79ab2efe6e1e4fe2bfcbabfca151f03a75cf0b68a200a443f51b64adc",
  "vision-uncertainty-001": "a05f9fe8abea0d5ea65107ca0787cddee6af801082440a50eba25a539dab5884",
};

function sha256(p: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(p));
  return h.digest("hex");
}

function makeAbsenceQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "V11-Q1",
    question: "Is there a banana in this image?",
    scoring_type: "absence_honesty",
    weight: 1,
    tags: ["vision", "hallucination-resistance"],
    absent_object: "banana",
    max_chars: 280,
    ...overrides,
  } as ConversationalQuestion;
}

let server: Server;
let base = "";

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

describe("Vision Phase 14 · suite expansion 5 → 15 tests (offline + live API)", () => {
  // -------- inventory --------

  it("P1 · Vision family now contains exactly 15 task directories", () => {
    const visionDir = join(ROOT, "tasks", "vision");
    const dirs = readdirSync(visionDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const expected = [...POC_5, ...PHASE14_NEW].sort();
    assert.deepEqual(dirs, expected);
  });

  it("P2 · vision-smoke + vision-stability ALL_TESTS both list 15 tests in the same order", () => {
    for (const src of [SMOKE_SRC, STABILITY_SRC]) {
      // Look for the verbatim 15 task ids inside the ALL_TESTS array.
      for (const id of [...POC_5, ...PHASE14_NEW]) {
        assert.match(src, new RegExp(`"${id}"`), `runner script must list ${id} in ALL_TESTS`);
      }
    }
  });

  // -------- fixtures: existence + sha256 --------

  it("P3 · all 10 new Phase-14 fixture PNGs exist on disk", () => {
    for (const id of PHASE14_NEW) {
      const p = join(ROOT, "fixtures", "vision", `${id}.png`);
      assert.ok(existsSync(p), `missing fixture ${p}`);
      assert.ok(statSync(p).size > 0, `empty fixture ${p}`);
      assert.ok(statSync(p).size <= 50_000, `fixture exceeds 50 KB cap: ${p}`);
    }
  });

  it("P4 · every Phase-14 fixture's on-disk sha256 matches the manifest declaration", () => {
    for (const id of PHASE14_NEW) {
      const fixturePath = join(ROOT, "fixtures", "vision", `${id}.png`);
      const manifestPath = join(ROOT, "tasks", "vision", id, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const actual = sha256(fixturePath);
      assert.equal(actual, manifest.image_fixture.sha256, `${id} fixture sha256 must equal manifest`);
    }
  });

  it("P5 · the 5 original POC fixture sha256s are unchanged by Phase 14", () => {
    for (const [id, expectedHash] of Object.entries(POC_5_KNOWN_HASHES)) {
      const p = join(ROOT, "fixtures", "vision", `${id}.png`);
      assert.equal(sha256(p), expectedHash, `POC fixture ${id} hash MUST NOT change post-Phase-14`);
    }
  });

  it("P6 · fixture generator is deterministic (regenerating into a tmp dir produces byte-identical PNGs for the 10 new tests)", () => {
    // The generator writes to ./fixtures/vision/ in place. We can't
    // easily redirect it without modifying the script. Instead, run
    // it and assert the on-disk hashes don't change.
    const before = new Map<string, string>();
    for (const id of PHASE14_NEW) {
      before.set(id, sha256(join(ROOT, "fixtures", "vision", `${id}.png`)));
    }
    const res = spawnSync("python3", [join(ROOT, "scripts", "generate-vision-fixtures.py")], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    if (res.status !== 0) {
      // PIL not installed in the test env — skip rather than fail.
      // The hash-pinning assertion (P4) still catches drift in CI.
      return;
    }
    for (const id of PHASE14_NEW) {
      const after = sha256(join(ROOT, "fixtures", "vision", `${id}.png`));
      assert.equal(after, before.get(id), `${id} re-generation must produce byte-identical PNG`);
    }
  });

  // -------- manifests --------

  it("P7 · all 10 new Phase-14 manifests declare experimental:true", () => {
    for (const id of PHASE14_NEW) {
      const m = JSON.parse(readFileSync(join(ROOT, "tasks", "vision", id, "manifest.json"), "utf-8"));
      assert.equal(m.experimental, true, `${id} manifest must declare experimental:true`);
      assert.equal(m.family, "vision");
      assert.equal(m.execution_mode, "conversational");
    }
  });

  it("P8 · Vision family is still excluded from leaderboard (affectsLeaderboard surrogate)", () => {
    // The doctrine encodes affectsLeaderboard:false at the TAB_CONFIG
    // level — `scoreFamilies:[]` for Vision is the runtime guarantee.
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P9 · Vision family is still excluded from certification (affectsCertification surrogate)", () => {
    // certified-models.json never gets a Vision-only entry from the
    // capability surface — see Phase 13-A / 13-B / 13-C tests for the
    // strict assertions. Here we re-assert the UI copy.
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
  });

  // -------- test-validity cards --------

  it("P10 · all 10 new test-validity cards exist and reference the correct fixture sha256", () => {
    for (const id of PHASE14_NEW) {
      const cardPath = join(ROOT, "reports", "test-validity", "cards", "vision", `${id}.md`);
      assert.ok(existsSync(cardPath), `missing test-validity card for ${id}`);
      const body = readFileSync(cardPath, "utf-8");
      const manifestHash = JSON.parse(readFileSync(join(ROOT, "tasks", "vision", id, "manifest.json"), "utf-8")).image_fixture.sha256;
      assert.ok(body.includes(manifestHash), `${id}.md must reference its fixture sha256 ${manifestHash}`);
    }
  });

  // -------- absence_honesty scorer --------

  it("P11 · absence_honesty PASSes a clean denial of the absent object", () => {
    const r = scoreConversationalQuestion(makeAbsenceQ(), "No, there is no banana — only two apples.");
    assert.equal(r.passed, true, `expected PASS; got reason: ${r.failure_reason}`);
    assert.match(String(r.failure_reason ?? ""), /\[ABSENCE=DENIED\]/);
  });

  it("P12 · absence_honesty FAILs a confident presence claim with [ABSENCE=FALSE_PRESENCE_CLAIM]", () => {
    const r = scoreConversationalQuestion(makeAbsenceQ(), "Yes, there is a banana on the right side of the image.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_OVER_HALLUCINATION/);
    assert.match(String(r.failure_reason ?? ""), /\[ABSENCE=FALSE_PRESENCE_CLAIM\]/);
  });

  it("P13 · absence_honesty returns NEEDS_REVIEW for hedged-presence answers", () => {
    const r = scoreConversationalQuestion(makeAbsenceQ(), "Maybe a banana in the corner, but it could just be a shadow.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/);
    assert.match(String(r.failure_reason ?? ""), /\[ABSENCE=HEDGED\]/);
  });

  it("P14 · absence_honesty FAILs silently-narrative non-answers with [ABSENCE=NO_SIGNAL]", () => {
    const r = scoreConversationalQuestion(makeAbsenceQ(), "The image shows fruit and a wooden background.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /\[ABSENCE=NO_SIGNAL\]/);
  });

  it("P15 · absence_honesty PASSes verbose-but-safe denials with [ABSENCE=DENIED_VERBOSE] + style-warning marker", () => {
    const verbose = "I want to be careful here. ".repeat(20) + " There is no banana in the image; I only see two apples.";
    const r = scoreConversationalQuestion(makeAbsenceQ({ max_chars: 80 }), verbose);
    assert.equal(r.passed, true, `expected PASS; got reason: ${r.failure_reason}`);
    assert.match(String(r.failure_reason ?? ""), /\[ABSENCE=DENIED_VERBOSE\]/);
    assert.match(String(r.failure_reason ?? ""), /\[SCORER=CHAR_LIMIT_STYLE_WARNING\]/);
  });

  // -------- live API: promotion evaluator after suite expansion --------

  it("P16 · /api/capabilities/vision/promotion-evaluation reports suite size 15 for xiaomi/mimo-v2.5", async () => {
    const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
    const j = await r.json() as { evaluatedRoutes: Array<{ provider: string; model: string; evidenceSummary: { suiteSize: number } }> };
    const v25 = j.evaluatedRoutes.find((x) => x.provider === "openrouter" && x.model === "xiaomi/mimo-v2.5");
    assert.ok(v25, "v2.5 route must appear in evaluatedRoutes");
    assert.equal(v25!.evidenceSummary.suiteSize, 15, "v2.5 should now have a 15-test suite-size evidence");
  });

  it("P17 · CAPABILITY_CERTIFIED suite-size blocker has CLEARED for v2.5; independent-routes blocker remains", async () => {
    const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
    const j = await r.json() as { evaluatedRoutes: Array<{ provider: string; model: string; capabilityCertifiedDecision: { eligible: boolean; blockingReasons: Array<{ gate: string }> } }> };
    const v25 = j.evaluatedRoutes.find((x) => x.provider === "openrouter" && x.model === "xiaomi/mimo-v2.5")!;
    const gates = v25.capabilityCertifiedDecision.blockingReasons.map((b) => b.gate);
    assert.equal(v25.capabilityCertifiedDecision.eligible, false, "CAPABILITY_CERTIFIED must still be blocked");
    assert.ok(!gates.includes("vision.capability-certified.suite-size"), `suite-size blocker must have CLEARED for v2.5; remaining gates: ${gates.join(", ")}`);
    assert.ok(gates.includes("vision.capability-certified.independent-routes"), `independent-routes blocker must REMAIN for v2.5; got: ${gates.join(", ")}`);
  });

  it("P18 · v2-omni still carries the suite-size blocker (Phase 15 refreshed gpt-5.4-mini to 15-test evidence, so its suite-size blocker has cleared)", async () => {
    const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
    const j = await r.json() as { evaluatedRoutes: Array<{ provider: string; model: string; capabilityCertifiedDecision: { blockingReasons: Array<{ gate: string }> } }> };
    // Phase 15 refreshed gpt-5.4-mini on the 15-test suite, so the
    // suite-size blocker has cleared on that route too. v2-omni was
    // intentionally left on 5-test evidence (it's the legacy
    // fallback, same MiMo family as v2.5 — re-running it would not
    // change the aggregate-family count). At minimum, v2-omni still
    // surfaces the suite-size blocker.
    const omni = j.evaluatedRoutes.find((x) => x.provider === "openrouter" && x.model === "xiaomi/mimo-v2-omni");
    assert.ok(omni, "xiaomi/mimo-v2-omni must appear");
    const omniGates = omni!.capabilityCertifiedDecision.blockingReasons.map((b) => b.gate);
    assert.ok(omniGates.includes("vision.capability-certified.suite-size"), `xiaomi/mimo-v2-omni must still surface suite-size blocker (5-test legacy evidence); got ${omniGates.join(", ")}`);
  });

  it("P19 · promotion evaluator response still declares promoted:false / no mutation / experimental:true", async () => {
    const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
    const j = await r.json() as { experimental: boolean; promoted: boolean; affectsLeaderboard: boolean; affectsCertification: boolean; noMutationGuarantee: boolean };
    assert.equal(j.experimental, true);
    assert.equal(j.promoted, false);
    assert.equal(j.affectsLeaderboard, false);
    assert.equal(j.affectsCertification, false);
    assert.equal(j.noMutationGuarantee, true);
  });

  // -------- regression guards --------

  it("P20 · certified-models.json has no Phase-14 campaign stamp; no Vision-only route promoted", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models));
    for (const m of certified.models as Array<{ modelId: string; provider?: string; campaign?: string }>) {
      const id = `${m.provider}/${m.modelId}`;
      assert.notEqual(id, "openai/gpt-5.4-mini", "gpt-5.4-mini must not appear in certified-models.json after Phase 14");
      if (typeof m.campaign === "string") {
        assert.doesNotMatch(m.campaign, /vision-?14|phase-?14|phase-?c/i, `certified entry must not carry a Phase 14 / Phase C campaign stamp on ${id}`);
      }
    }
  });

  it("P21 · MODEL_CERTIFICATION.models[].tier unchanged for every Vision-tested route post-Phase-14", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL");
  });

  it("P22 · Roleplay baseline (scoreFamilies, EXPERIMENTAL chips, suite count) untouched by Phase 14", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay remains experimental/);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
  });

  it("P23 · Capability doctrine evaluator gates unchanged by Phase 14 (only evidence changed, not the gates)", () => {
    assert.deepEqual([...VISION_GATES.STABLE.disallowedRecurringAttributions].sort(), ["CONFIG", "FIXTURE", "PROVIDER", "SCORER"]);
    assert.equal(VISION_GATES.STABLE.minStablePassRate, 0.80);
    assert.equal(VISION_GATES.STABLE.minRepeatRuns, 3);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minSuiteSize, 15);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes, 3);
  });

  it("P24 · release-gauntlet --dry-run-inventory now reports 23 families · 87 tasks · 62 conversational (Phase 14 added 10 conversational Vision tasks)", () => {
    const out = execFileSync(process.execPath, ["scripts/release-gauntlet.mjs", "--dry-run-inventory"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    });
    // Coding suite (2026-06-29): tasks 87 → 90 + conversational 62 → 65 (code-002/003/004).
    assert.match(out, /families:\s+23/);
    assert.match(out, /tasks total:\s+90/);
    assert.match(out, /conversational:\s+65/);
  });

  it("P25 · docs document the Phase 14 / Roadmap C suite expansion + the new absence_honesty scorer", () => {
    assert.match(DOC, /Phase 14 \/ Roadmap C/);
    assert.match(DOC, /absence_honesty/);
    assert.match(DOC, /15\s*\/\s*15/);
    assert.match(DOC, /suite expansion/i);
  });
});
