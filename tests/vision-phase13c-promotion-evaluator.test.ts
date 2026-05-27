/**
 * Crucible — Vision Phase 13-C / Roadmap D: read-only promotion
 * evaluator endpoint (live HTTP tests + UI + regressions).
 *
 * Stands up the real Crucible app via createApp() on an ephemeral port
 * and exercises the new GET /api/capabilities/vision/promotion-evaluation
 * route end-to-end. Covers:
 *
 *   - endpoint exists + GET-only
 *   - no POST/PUT/PATCH promotion endpoint registered
 *   - response shape (experimental:true · promoted:false ·
 *     affectsLeaderboard:false · affectsCertification:false ·
 *     noMutationGuarantee:true · promotionRequiresFutureWritePhase:true)
 *   - preferredDailyDriver = openrouter/xiaomi/mimo-v2.5
 *   - legacyFallbacks includes openrouter/xiaomi/mimo-v2-omni
 *   - evaluatedRoutes carries PROVIDER_TESTED + STABLE + CAPABILITY_CERTIFIED
 *     decisions for each tested route
 *   - CAPABILITY_CERTIFIED has the 5/15 suite-size blocker on every
 *     route (the doctrine should never let this through today)
 *   - missing evidence does not crash the route; it surfaces as a
 *     blocker on every per-tier decision
 *   - UI block + wording (Eligible in dry-run / Not promoted, never
 *     "Certified" or "Promoted" outside negation contexts)
 *   - exclusion + certified-models + tier + capability-doctrine
 *     regressions all still hold
 *
 * No provider calls. No network outside 127.0.0.1.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Isolate harness FS before importing anything env-aware.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase13c-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase13c-state-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase13c-links-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
process.env["CRUCIBLE_HMAC_KEY"] = "phase13c-test-hmac";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { VISION_GATES } = await import("../core/capability-certification.js");

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOCT = readFileSync(join(ROOT, "docs", "CAPABILITY_CERTIFICATION_DOCTRINE.md"), "utf-8");
const VDOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");

let server: Server;
let base = "";

interface PromoResp {
  capability: string;
  experimental: boolean;
  promoted: boolean;
  affectsLeaderboard: boolean;
  affectsCertification: boolean;
  currentTier: string;
  preferredDailyDriver: {
    provider: string;
    model: string;
    role: string;
    promotionExecuted: boolean;
    affectsLeaderboard: boolean;
    affectsCertification: boolean;
  } | null;
  legacyFallbacks: Array<{ provider: string; model: string; role: string; promotionExecuted: boolean; affectsLeaderboard: boolean; affectsCertification: boolean }>;
  evaluatedRoutes: Array<{
    provider: string;
    model: string;
    role: string;
    currentTier: string;
    evidenceSource: string;
    evidenceSummary: { evidencePresent: boolean; missingEvidenceReason: string | null; suiteSize: number; repeatRuns: number; stablePassRate: number; recurringAttributions: string[] };
    providerTestedDecision: { eligible: boolean; blockingReasons: Array<{ gate: string }>; affectsLeaderboard: boolean; affectsCertification: boolean; proposedTier: string };
    stableDecision: { eligible: boolean; blockingReasons: Array<{ gate: string }>; affectsLeaderboard: boolean; affectsCertification: boolean; proposedTier: string };
    capabilityCertifiedDecision: { eligible: boolean; blockingReasons: Array<{ gate: string }>; affectsLeaderboard: boolean; affectsCertification: boolean; proposedTier: string };
    affectsLeaderboard: boolean;
    affectsCertification: boolean;
    promoted: boolean;
  }>;
  doctrine: { providerTestedGate: unknown; stableGate: unknown; capabilityCertifiedGate: unknown };
  noMutationGuarantee: boolean;
  promotionRequiresFutureWritePhase: boolean;
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

async function getPromo(): Promise<{ status: number; body: PromoResp }> {
  const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
  return { status: r.status, body: (await r.json()) as PromoResp };
}

describe("Vision Phase 13-C · read-only promotion evaluator endpoint", () => {
  // -------- endpoint shape --------

  it("P1 · GET /api/capabilities/vision/promotion-evaluation returns 200", async () => {
    const { status } = await getPromo();
    assert.equal(status, 200);
  });

  it("P2 · endpoint is GET-only — POST/PUT/PATCH/DELETE all return 404", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`, {
        method,
        ...(method === "POST" || method === "PUT" || method === "PATCH" ? { body: JSON.stringify({}) } : {}),
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(r.status, 404, `method ${method} must not be registered; got status ${r.status}`);
    }
  });

  it("P3 · no /api/capabilities/vision/promote (or similar write-phase path) is registered", async () => {
    for (const writePath of [
      "/api/capabilities/vision/promote",
      "/api/capabilities/vision/promotion",
      "/api/capabilities/vision/certify",
      "/api/capabilities/promote",
    ]) {
      const r = await fetch(`${base}${writePath}`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
      assert.equal(r.status, 404, `write-phase path ${writePath} must not be registered yet`);
    }
  });

  it("P4 · response declares experimental:true", async () => {
    const { body } = await getPromo();
    assert.equal(body.experimental, true);
  });

  it("P5 · response declares promoted:false", async () => {
    const { body } = await getPromo();
    assert.equal(body.promoted, false);
  });

  it("P6 · response declares affectsLeaderboard:false (top-level + every nested decision)", async () => {
    const { body } = await getPromo();
    assert.equal(body.affectsLeaderboard, false);
    for (const r of body.evaluatedRoutes) {
      assert.equal(r.affectsLeaderboard, false);
      assert.equal(r.providerTestedDecision.affectsLeaderboard, false);
      assert.equal(r.stableDecision.affectsLeaderboard, false);
      assert.equal(r.capabilityCertifiedDecision.affectsLeaderboard, false);
    }
  });

  it("P7 · response declares affectsCertification:false (top-level + every nested decision)", async () => {
    const { body } = await getPromo();
    assert.equal(body.affectsCertification, false);
    for (const r of body.evaluatedRoutes) {
      assert.equal(r.affectsCertification, false);
      assert.equal(r.providerTestedDecision.affectsCertification, false);
      assert.equal(r.stableDecision.affectsCertification, false);
      assert.equal(r.capabilityCertifiedDecision.affectsCertification, false);
    }
  });

  it("P8 · preferredDailyDriver targets openrouter / xiaomi/mimo-v2.5 with literal-false doctrine flags", async () => {
    const { body } = await getPromo();
    assert.ok(body.preferredDailyDriver, "preferredDailyDriver must be present");
    assert.equal(body.preferredDailyDriver!.provider, "openrouter");
    assert.equal(body.preferredDailyDriver!.model, "xiaomi/mimo-v2.5");
    assert.equal(body.preferredDailyDriver!.promotionExecuted, false);
    assert.equal(body.preferredDailyDriver!.affectsLeaderboard, false);
    assert.equal(body.preferredDailyDriver!.affectsCertification, false);
  });

  it("P9 · legacyFallbacks includes openrouter / xiaomi/mimo-v2-omni with literal-false doctrine flags", async () => {
    const { body } = await getPromo();
    const omni = body.legacyFallbacks.find((f) => f.provider === "openrouter" && f.model === "xiaomi/mimo-v2-omni");
    assert.ok(omni, "Omni must be in legacyFallbacks");
    assert.equal(omni!.promotionExecuted, false);
    assert.equal(omni!.affectsLeaderboard, false);
    assert.equal(omni!.affectsCertification, false);
  });

  it("P10 · evaluatedRoutes carries Provider-Tested decisions for every tested route", async () => {
    const { body } = await getPromo();
    assert.ok(body.evaluatedRoutes.length >= 3, "expected at least 3 evaluated Vision routes");
    for (const r of body.evaluatedRoutes) {
      assert.equal(r.providerTestedDecision.proposedTier, "PROVIDER_TESTED");
      assert.equal(typeof r.providerTestedDecision.eligible, "boolean");
    }
  });

  it("P11 · evaluatedRoutes carries Stable decisions for every tested route", async () => {
    const { body } = await getPromo();
    for (const r of body.evaluatedRoutes) {
      assert.equal(r.stableDecision.proposedTier, "STABLE");
      assert.equal(typeof r.stableDecision.eligible, "boolean");
    }
  });

  it("P12 · CAPABILITY_CERTIFIED is blocked on every route (suite-size OR independent-routes — Phase 14 cleared suite-size for v2.5)", async () => {
    // Phase 14 / Roadmap C grew Vision to 15 tests and v2.5 ran the
    // full-suite stability profile, which cleared the suite-size
    // blocker for v2.5. The independent-routes blocker (1<3) still
    // persists for every route, so CAPABILITY_CERTIFIED is still
    // blocked everywhere — exactly what the doctrine should enforce.
    // For routes whose stability evidence is still on 5 tests (v2-omni
    // and gpt-5.4-mini in current snapshots), the suite-size blocker
    // remains visible too.
    const { body } = await getPromo();
    for (const r of body.evaluatedRoutes) {
      assert.equal(r.capabilityCertifiedDecision.proposedTier, "CAPABILITY_CERTIFIED");
      assert.equal(r.capabilityCertifiedDecision.eligible, false, `${r.provider}/${r.model} CAPABILITY_CERTIFIED must be blocked today`);
      const gates = r.capabilityCertifiedDecision.blockingReasons.map((b) => b.gate);
      // At least ONE structural blocker (suite-size, independent-routes,
      // or evidence-missing) must remain so promotion stays impossible.
      const hasSuite = gates.includes("vision.capability-certified.suite-size");
      const hasRoutes = gates.includes("vision.capability-certified.independent-routes");
      const hasMissing = gates.includes("vision.capability-certified.evidence-missing");
      assert.ok(hasSuite || hasRoutes || hasMissing, `${r.provider}/${r.model} must surface at least one CAPABILITY_CERTIFIED structural blocker; got: ${gates.join(", ")}`);
    }
  });

  it("P13 · top-level guarantees noMutationGuarantee:true and promotionRequiresFutureWritePhase:true", async () => {
    const { body } = await getPromo();
    assert.equal(body.noMutationGuarantee, true);
    assert.equal(body.promotionRequiresFutureWritePhase, true);
    assert.equal(body.currentTier, "EXPERIMENTAL");
  });

  it("P14 · missing evidence does not crash the route; per-tier decisions surface evidence-missing blockers", async () => {
    // Temporarily hide the stability dir contents to simulate "no
    // evidence on disk yet". We rename the dir back at the end so the
    // rest of the suite isn't affected.
    const stabilityDir = join(ROOT, "reports", "capability-expansion", "vision-stability");
    const backupDir = stabilityDir + ".phase13c-tests-backup";
    let didRename = false;
    if (existsSync(stabilityDir)) {
      renameSync(stabilityDir, backupDir);
      didRename = true;
    }
    try {
      const { status, body } = await getPromo();
      assert.equal(status, 200, "endpoint must respond 200 even with no evidence on disk");
      assert.equal(body.experimental, true);
      assert.equal(body.promoted, false);
      for (const r of body.evaluatedRoutes) {
        assert.equal(r.evidenceSummary.evidencePresent, false, `${r.provider}/${r.model} must report evidencePresent:false when stability dir is gone`);
        const ptGates = r.providerTestedDecision.blockingReasons.map((b) => b.gate);
        assert.ok(ptGates.some((g) => g.includes("evidence-missing")), `${r.provider}/${r.model} PROVIDER_TESTED must surface an evidence-missing blocker; got ${ptGates.join(", ")}`);
      }
    } finally {
      if (didRename) renameSync(backupDir, stabilityDir);
    }
  });

  // -------- UI block + wording --------

  it("P15 · UI Vision panel renders the PROMOTION DRY RUN (READ-ONLY) block with allowed wording", () => {
    assert.match(HTML, /PROMOTION DRY RUN \(READ-ONLY\)/);
    assert.match(HTML, /\/api\/capabilities\/vision\/promotion-evaluation/);
    assert.match(HTML, /Eligible in dry-run/);
    // The PROMOTION DRY RUN block declares promotion executed: no.
    assert.match(HTML, /Promotion executed:\s*<strong>no<\/strong>/i);
  });

  it("P16 · UI preserves EXPERIMENTAL / NOT IN LEADERBOARD / NOT CERTIFIED chips and capability-certified blocker copy (Phase 15: per-route 1/3 routes message)", () => {
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
    // Phase 15 simplified the per-route Capability-Certified blocked
    // chip to "per-route 1/3 routes" (the per-route view always has
    // independent-routes as a blocker by construction; the suite-size
    // half of the blocker can clear independently per route as their
    // stability evidence is refreshed on the 15-test suite).
    assert.match(HTML, /1\/3 routes/);
  });

  it("P17 · UI promotion dry-run block does NOT use 'Certified' or 'Promoted' outside negation contexts", () => {
    // The block lives inside renderVisionLanePanel; we already check
    // the page-wide UI panel wording in Phase 13-B P9, but the new
    // Phase 13-C block needs its own pass.
    const blockStart = HTML.indexOf("PROMOTION DRY RUN (READ-ONLY)");
    assert.notEqual(blockStart, -1);
    const blockBody = HTML.slice(blockStart, blockStart + 2400);
    // 'Certified' only appears in 'Capability-Certified' (the column
    // header / chip label — which is itself a tier name, not a claim).
    const certifiedHits = [...blockBody.matchAll(/\bcertified\b/gi)];
    for (const m of certifiedHits) {
      const win = blockBody.slice(Math.max(0, m.index! - 30), m.index! + 30).toLowerCase();
      assert.ok(
        /capability-certified|capability_certified|not certified|capability-certification/i.test(win),
        `dry-run block uses "certified" outside Capability-Certified context; window: ${win}`,
      );
    }
    // 'Promoted' only appears as a column header / value-no row.
    const promotedHits = [...blockBody.matchAll(/promoted/gi)];
    for (const m of promotedHits) {
      const win = blockBody.slice(Math.max(0, m.index! - 40), m.index! + 60).toLowerCase();
      assert.ok(
        /\bno\b|\bnot\b|\bnever\b/.test(win) || /<th[^>]*>promoted<\/th>/i.test(win) || /executed:\s*<strong>no/i.test(win),
        `dry-run block uses "promoted" outside negation/header context; window: ${win}`,
      );
    }
  });

  // -------- docs --------

  it("P18 · capability doctrine doc documents the Phase D read-only endpoint", () => {
    assert.match(DOCT, /\/api\/capabilities\/vision\/promotion-evaluation/);
    assert.match(DOCT, /read-only/i);
    assert.match(DOCT, /noMutationGuarantee/);
  });

  it("P19 · MULTIMODAL_VISION_SUITE doc documents the dry-run evaluator section", () => {
    assert.match(VDOC, /Promotion dry-run evaluator/i);
    assert.match(VDOC, /\/api\/capabilities\/vision\/promotion-evaluation/);
    assert.match(VDOC, /CAPABILITY_CERTIFIED is currently blocked|capability-certified.*blocked/i);
    assert.match(VDOC, /5 tests.*15|15 tests/);
  });

  // -------- regression guards --------

  it("P20 · Vision tab still contributes zero score families (leaderboard exclusion preserved)", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P21 · certified-models.json has no Vision-only route added by Phase 13-C", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models));
    for (const m of certified.models as Array<{ modelId: string; provider?: string; campaign?: string }>) {
      const id = `${m.provider}/${m.modelId}`;
      assert.notEqual(id, "openai/gpt-5.4-mini", "gpt-5.4-mini must not appear in certified-models.json after Phase 13-C");
      if (typeof m.campaign === "string") {
        assert.doesNotMatch(m.campaign, /vision-13c|phase-?13-?c|phase-?d/i, `certified entry must not carry a Phase 13-C campaign stamp on ${id}`);
      }
    }
  });

  it("P22 · MODEL_CERTIFICATION.models[].tier unchanged for every Vision-tested route post-Phase-13-C", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL", "gpt-5.4-mini Vision-experimental tier must remain unchanged");
  });

  it("P23 · Capability doctrine evaluator gates unchanged + Roleplay baseline intact", () => {
    const stableDisallowed = [...VISION_GATES.STABLE.disallowedRecurringAttributions].sort();
    assert.deepEqual(stableDisallowed, ["CONFIG", "FIXTURE", "PROVIDER", "SCORER"]);
    assert.equal(VISION_GATES.STABLE.minStablePassRate, 0.80);
    assert.equal(VISION_GATES.STABLE.minRepeatRuns, 3);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minSuiteSize, 15);
    assert.equal(VISION_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes, 3);
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay remains experimental/);
  });

  it("P24 · task inventory pinned (23 families · vision 15 post-Phase-14 · roleplay 10)", () => {
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(taskFams.length, 23, `task family count must remain 23; got ${taskFams.length}`);
    // Phase 14 / Roadmap C grew Vision 5 → 15.
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 15);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
  });
});
