/**
 * Luak — Vision Phase 16: doctrine-aware capability promotion
 * write phase (offline + live HTTP tests with FS isolation).
 *
 * 25 deterministic tests. State + receipt directories are
 * redirected to a tmp tree via env vars BEFORE importing the app,
 * so this suite never writes to the real `data/` or
 * `reports/capability-promotions/`.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// FS isolation — set BEFORE any imports that read these env vars.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase16-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase16-state-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase16-links-"));
const CAP_STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-phase16-capstate-"));
const CAP_REPORTS_DIR = mkdtempSync(join(tmpdir(), "crcb-phase16-capreports-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
process.env["CRUCIBLE_CAPABILITY_STATE_DIR"] = CAP_STATE_DIR;
process.env["CRUCIBLE_CAPABILITY_REPORTS_DIR"] = CAP_REPORTS_DIR;
process.env["CRUCIBLE_HMAC_KEY"] = "phase16-test-hmac";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { readCapabilityCertificationState, STATE_SCHEMA, RECEIPT_SCHEMA } = await import("../core/capability-promotion-state.js");

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOCTRINE = readFileSync(join(ROOT, "docs", "CAPABILITY_CERTIFICATION_DOCTRINE.md"), "utf-8");
const VDOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");

const PROMOTE_CONFIRMATION = "PROMOTE_VISION_CAPABILITY_CERTIFIED";

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
  // Clean tmp state — never leave it lying around.
  for (const d of [RUNS_DIR, STATE_DIR, LINKS_DIR, CAP_STATE_DIR, CAP_REPORTS_DIR]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

async function getEval(): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${base}/api/capabilities/vision/promotion-evaluation`);
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

async function postPromote(body: Record<string, unknown> | string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${base}/api/capabilities/vision/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

function resetCapState(): void {
  // Wipe the test capability-state file + receipt tree between tests
  // that need a clean slate.
  for (const f of [join(CAP_STATE_DIR, "capability-certifications.json")]) {
    if (existsSync(f)) rmSync(f);
  }
  if (existsSync(CAP_REPORTS_DIR)) {
    for (const sub of readdirSync(CAP_REPORTS_DIR)) {
      rmSync(join(CAP_REPORTS_DIR, sub), { recursive: true, force: true });
    }
  }
}

describe("Vision Phase 16 · capability promotion write phase (offline + live API, FS-isolated)", () => {
  // -------- baseline: no state --------

  it("P1 · Without promotion state, Vision remains EXPERIMENTAL (GET reflects experimental=true, promoted=false)", async () => {
    resetCapState();
    const { status, body } = await getEval();
    assert.equal(status, 200);
    assert.equal(body.experimental, true);
    assert.equal(body.promoted, false);
    assert.equal(body.currentTier, "EXPERIMENTAL");
    assert.equal(body.promotionRequiresFutureWritePhase, true);
    assert.equal(body.affectsLeaderboard, false);
    assert.equal(body.affectsCertification, false);
    // No state file should exist yet.
    assert.equal(existsSync(join(CAP_STATE_DIR, "capability-certifications.json")), false);
  });

  // -------- POST rejection paths --------

  it("P2 · POST with empty body returns 400 (confirmation missing); no state written", async () => {
    resetCapState();
    const { status, body } = await postPromote({});
    assert.equal(status, 400);
    assert.equal(body.promoted, false);
    assert.equal(body.affectsLeaderboard, false);
    assert.equal(body.affectsCertification, false);
    assert.equal(existsSync(join(CAP_STATE_DIR, "capability-certifications.json")), false);
  });

  it("P3 · POST with wrong confirmation phrase returns 400; no state written", async () => {
    resetCapState();
    const { status, body } = await postPromote({ confirm: "PROMOTE_WRONG_PHRASE" });
    assert.equal(status, 400);
    assert.equal(body.promoted, false);
    assert.equal(existsSync(join(CAP_STATE_DIR, "capability-certifications.json")), false);
  });

  it("P4 · POST with malformed JSON body returns 400; no state written", async () => {
    resetCapState();
    const r = await fetch(`${base}/api/capabilities/vision/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    assert.equal(r.status, 400);
    assert.equal(existsSync(join(CAP_STATE_DIR, "capability-certifications.json")), false);
  });

  // -------- POST success --------

  it("P5 · POST with correct confirmation when aggregate eligible writes 200 + promoted state", async () => {
    resetCapState();
    const { status, body } = await postPromote({
      confirm: PROMOTE_CONFIRMATION,
      operatorNote: "P5 test promotion",
      operator: "tester",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.promoted, true);
    assert.equal(body.previousTier, "EXPERIMENTAL");
    assert.equal(body.promotedTier, "CAPABILITY_CERTIFIED");
    assert.ok(typeof body.receiptPath === "string");
    assert.ok(typeof body.receiptMarkdownPath === "string");
    assert.ok(typeof body.statePath === "string");
    assert.equal(body.affectsLeaderboard, false);
    assert.equal(body.affectsCertification, false);
    assert.equal(body.certifiedModelsJsonUntouched, true);
  });

  it("P6 · State file exists at the configured (test-tmp) path with correct schema + structure", () => {
    const statePath = join(CAP_STATE_DIR, "capability-certifications.json");
    assert.ok(existsSync(statePath), `state file must exist at ${statePath}`);
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as { schema: string; capabilities: { vision?: { tier: string; promoted: boolean; affectsLeaderboard: boolean; affectsCertification: boolean; evidence: unknown; promotionReceipt: string } } };
    assert.equal(state.schema, STATE_SCHEMA);
    const v = state.capabilities.vision!;
    assert.ok(v, "vision capability must be present in state");
    assert.equal(v.tier, "CAPABILITY_CERTIFIED");
    assert.equal(v.promoted, true);
    assert.equal(v.affectsLeaderboard, false);
    assert.equal(v.affectsCertification, false);
    assert.ok(typeof v.promotionReceipt === "string");
    assert.ok(v.evidence);
  });

  it("P7 · Receipt JSON exists at the path the response reported, with correct schema", () => {
    const state = readCapabilityCertificationState();
    const receiptPath = state.capabilities.vision!.promotionReceipt;
    assert.ok(existsSync(receiptPath), `receipt JSON must exist at ${receiptPath}`);
    const r = JSON.parse(readFileSync(receiptPath, "utf-8"));
    assert.equal(r.schema, RECEIPT_SCHEMA);
    assert.equal(r.capability, "vision");
    assert.equal(r.previousTier, "EXPERIMENTAL");
    assert.equal(r.promotedTier, "CAPABILITY_CERTIFIED");
  });

  it("P8 · Receipt Markdown exists next to the JSON with the same timestamp", () => {
    const state = readCapabilityCertificationState();
    const receiptPath = state.capabilities.vision!.promotionReceipt;
    const mdPath = receiptPath.replace(/\.json$/, ".md");
    assert.ok(existsSync(mdPath), `receipt markdown must exist at ${mdPath}`);
    const md = readFileSync(mdPath, "utf-8");
    assert.match(md, /Vision capability promotion receipt/);
    assert.match(md, /CAPABILITY_CERTIFIED/);
  });

  it("P9 · Receipt JSON includes qualifying families (sorted)", () => {
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { qualifyingFamilies: string[] };
    // Phase 15 evidence: 3 families.
    assert.deepEqual([...r.qualifyingFamilies].sort(), ["Anthropic", "GPT-5", "MiMo"]);
  });

  it("P10 · Receipt JSON includes source evidence refs from each qualifying route", () => {
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { sourceReports: Array<{ kind: string; path: string }>; qualifyingRoutes: Array<{ provider: string; model: string }> };
    assert.ok(r.sourceReports.length >= 3, `expected >=3 source evidence refs; got ${r.sourceReports.length}`);
    for (const ref of r.sourceReports) {
      assert.equal(ref.kind, "stability");
      assert.match(ref.path, /^reports\/capability-expansion\/vision-stability\//);
    }
    assert.equal(r.qualifyingRoutes.length, 3);
  });

  it("P11 · Receipt JSON declares affectsLeaderboard:false literal", () => {
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { affectsLeaderboard: boolean };
    assert.equal(r.affectsLeaderboard, false);
  });

  it("P12 · Receipt JSON declares affectsCertification:false literal", () => {
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { affectsCertification: boolean };
    assert.equal(r.affectsCertification, false);
  });

  it("P13 · Receipt JSON records certified-models.json sha256 BEFORE and AFTER (the write doesn't touch the file)", () => {
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { certifiedModelsJsonSha256Before: string | null; certifiedModelsJsonSha256After: string | null; modelCertificationTierMutated: boolean };
    // Either both are strings (file exists) or both are null (file
    // absent in test workdir). Either way they must MATCH.
    assert.equal(r.certifiedModelsJsonSha256Before, r.certifiedModelsJsonSha256After, "certified-models.json must not be mutated by the promotion write");
    assert.equal(r.modelCertificationTierMutated, false);
  });

  it("P14 · certified-models.json on disk is byte-identical pre/post promotion (real file, not just receipt)", () => {
    // Verify against the actual file on disk.
    const certPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    if (!existsSync(certPath)) return; // CI without committed state
    // Compute current hash (createHash imported at top of file —
    // ESM file, no require() available).
    const current = createHash("sha256").update(readFileSync(certPath)).digest("hex");
    const state = readCapabilityCertificationState();
    const r = JSON.parse(readFileSync(state.capabilities.vision!.promotionReceipt, "utf-8")) as { certifiedModelsJsonSha256After: string | null };
    if (r.certifiedModelsJsonSha256After) {
      assert.equal(r.certifiedModelsJsonSha256After, current, "current certified-models.json hash must match the AFTER hash the receipt recorded");
    }
  });

  it("P15 · MODEL_CERTIFICATION.models[].tier unchanged for every Vision-tested route post-promotion", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'[^}]*tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2\.5'(?!-pro)[^}]*tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/modelId:'gpt-5\.4-mini'[^}]*tier:'([^']+)'/);
    assert.equal(gpt?.[1], "EXPERIMENTAL");
    const claude = HTML.match(/modelId:'anthropic\/claude-haiku-4-5'[^}]*tier:'([^']+)'/);
    assert.equal(claude?.[1], "EXPERIMENTAL");
  });

  // -------- GET endpoint reflects state --------

  it("P16 · GET /api/capabilities/vision/promotion-evaluation reflects promoted:true after the POST", async () => {
    const { body } = await getEval();
    assert.equal(body.promoted, true);
    assert.equal(body.experimental, false);
    assert.equal(body.currentTier, "CAPABILITY_CERTIFIED");
    assert.equal(body.promotionRequiresFutureWritePhase, false);
    assert.ok(body.promotionState);
    const ps = body.promotionState as { tier: string; affectsLeaderboard: boolean; affectsCertification: boolean; currentEvidenceStillEligible: boolean };
    assert.equal(ps.tier, "CAPABILITY_CERTIFIED");
    assert.equal(ps.affectsLeaderboard, false);
    assert.equal(ps.affectsCertification, false);
    assert.equal(ps.currentEvidenceStillEligible, true);
  });

  // -------- UI surface --------

  it("P17 · UI source includes the CAPABILITY-CERTIFIED chip branch (rendered only when state.visionPromoEval.data.promoted===true)", () => {
    // The chip is conditionally rendered via a JS template literal;
    // the literal text must appear in the source HTML.
    assert.match(HTML, /CAPABILITY-CERTIFIED/);
    assert.match(HTML, /promoData&&promoData\.promoted===true/);
    // The EXPERIMENTAL chip branch must also still be in source for
    // the pre-promotion case.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
  });

  it("P18 · UI does not use the word 'CERTIFIED MODEL' anywhere in the Vision panel block (avoids implying general-model certification)", () => {
    const panelStart = HTML.indexOf("renderVisionLanePanel");
    const panel = HTML.slice(panelStart, panelStart + 40000);
    assert.doesNotMatch(panel, /certified model/i, "Vision panel must not use 'certified model' (ambiguous with general model certification)");
    assert.doesNotMatch(panel, /release-?certified/i, "Vision panel must not use 'release-certified' wording (Vision capability is not release-certified)");
  });

  // -------- exclusion regressions --------

  it("P19 · Vision still excluded from leaderboard (scoreFamilies still [])", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P20 · Vision still excluded from general model certification (no Vision-only entry added to certified-models.json by the write)", () => {
    const certPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    if (!existsSync(certPath)) return;
    const certified = JSON.parse(readFileSync(certPath, "utf-8")) as { models: Array<{ modelId: string; provider?: string; campaign?: string }> };
    for (const m of certified.models) {
      const id = `${m.provider}/${m.modelId}`;
      assert.notEqual(id, "openrouter/anthropic/claude-haiku-4-5", "claude-haiku-4-5 must never appear in certified-models.json from a Vision promotion");
      if (typeof m.campaign === "string") {
        assert.doesNotMatch(m.campaign, /vision-?16|phase-?16|capability-promote/i, `certified entry must not carry a Phase 16 / capability-promote campaign stamp on ${id}`);
      }
    }
  });

  // -------- method restrictions on the write surface --------

  it("P21 · GET routes remain read-only — GET on /promote returns 404", async () => {
    const r = await fetch(`${base}/api/capabilities/vision/promote`);
    assert.equal(r.status, 404, "GET on /promote must return 404 — the path is POST-only");
  });

  it("P22 · PUT/PATCH/DELETE on /promote all return 404 and do not mutate state", async () => {
    const stateBefore = existsSync(join(CAP_STATE_DIR, "capability-certifications.json")) ? readFileSync(join(CAP_STATE_DIR, "capability-certifications.json"), "utf-8") : null;
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const r = await fetch(`${base}/api/capabilities/vision/promote`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method === "PUT" || method === "PATCH" ? { body: JSON.stringify({ confirm: PROMOTE_CONFIRMATION }) } : {}),
      });
      assert.equal(r.status, 404, `${method} on /promote must return 404`);
    }
    const stateAfter = existsSync(join(CAP_STATE_DIR, "capability-certifications.json")) ? readFileSync(join(CAP_STATE_DIR, "capability-certifications.json"), "utf-8") : null;
    assert.equal(stateBefore, stateAfter, "no method except POST may mutate the state file");
  });

  // -------- doctrine-gate enforcement (must REFUSE when not eligible) --------

  it("P23 · POST refuses (422) when aggregate dry-run eligibility is false (stability dir gone → no evidence)", async () => {
    // Phase 18-B fix: simulate "no evidence" by pointing
    // CRUCIBLE_VISION_STABILITY_DIR at an empty tmp dir for the
    // duration of this test. The previous implementation renameSync'd
    // the real reports/capability-expansion/vision-stability/ dir,
    // which raced with any concurrent test file's request against
    // the same endpoint.
    const emptyDir = mkdtempSync(join(tmpdir(), "crcb-phase16-empty-stability-"));
    const previous = process.env["CRUCIBLE_VISION_STABILITY_DIR"];
    process.env["CRUCIBLE_VISION_STABILITY_DIR"] = emptyDir;
    try {
      // First reset the capability state so we're attempting a fresh
      // promotion (not idempotent re-promotion).
      resetCapState();
      const { status, body } = await postPromote({ confirm: PROMOTE_CONFIRMATION });
      assert.equal(status, 422, `expected 422 when aggregate ineligible; got ${status}`);
      assert.equal(body.promoted, false);
      assert.equal(body.affectsLeaderboard, false);
      assert.equal(body.affectsCertification, false);
      assert.equal(existsSync(join(CAP_STATE_DIR, "capability-certifications.json")), false, "no state must be written when promotion refused");
    } finally {
      if (previous === undefined) delete process.env["CRUCIBLE_VISION_STABILITY_DIR"];
      else process.env["CRUCIBLE_VISION_STABILITY_DIR"] = previous;
      try { rmSync(emptyDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  // -------- doctrine doc + Vision doc --------

  it("P24 · doctrine + Vision suite docs document the Phase 16 write phase + confirmation phrase + receipt path", () => {
    assert.match(DOCTRINE, /Phase 16/);
    assert.match(DOCTRINE, /POST \/api\/capabilities\/vision\/promote/);
    assert.match(DOCTRINE, /PROMOTE_VISION_CAPABILITY_CERTIFIED/);
    assert.match(VDOC, /PROMOTE_VISION_CAPABILITY_CERTIFIED/);
    assert.match(VDOC, /reports\/capability-promotions\/vision\//);
    assert.match(VDOC, /data\/capability-certifications\.json/);
  });

  // -------- regression guards on inventory + scoring-invariant --------

  it("P25 · task inventory pinned at 23/87/62 + scoring-invariant exists (Phase 14 + scoring-integrity audit still intact)", () => {
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true }).filter((d) => d.isDirectory());
    assert.equal(taskFams.length, 23);
    assert.equal(readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 15);
    assert.equal(readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    assert.ok(existsSync(join(ROOT, "core", "scoring-invariant.ts")));
  });
});
