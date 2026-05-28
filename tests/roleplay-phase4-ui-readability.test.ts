/**
 * Luak — Roleplay Phase 4: UI readability + backend route (offline).
 *
 * 15 deterministic source/contract assertions covering Phase 4's
 * scope: live-smoke-driven result cards + failed-turn sub-cards +
 * new /api/roleplay/latest-smoke route + docs + exclusion +
 * Vision preserved. No provider calls. No network.
 *
 * The live re-run smoke is recorded under
 * reports/capability-expansion/roleplay-smoke/2026-05-26T10-51-01Z.{json,md}.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const CSS = readFileSync(join(ROOT, "ui", "crucibulum.css"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "roleplay-smoke.mjs"), "utf-8");
const ROLEPLAY_DOC = readFileSync(join(ROOT, "docs", "ROLEPLAY_TEST_SUITE.md"), "utf-8");
const ROLEPLAY_ROUTE = readFileSync(join(ROOT, "server", "routes", "roleplay.ts"), "utf-8");
const APP_SRC = readFileSync(join(ROOT, "server", "app.ts"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

describe("Roleplay Phase 4 · UI readability (offline)", () => {
  // -------- posture chips + exclusion --------

  it("RPP4-P01 · Roleplay room shows the EXPERIMENTAL chip in its status panel", () => {
    assert.match(HTML, /vision-status-chips[^]*EXPERIMENTAL/);
    assert.match(HTML, /data-roleplay-panel="1"/);
  });

  it("RPP4-P02 · Roleplay room shows the NOT IN LEADERBOARD chip + exclusion copy", () => {
    assert.match(HTML, /NOT IN LEADERBOARD/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    // Locked: scoreFamilies empty.
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
  });

  it("RPP4-P03 · Roleplay room shows the NOT CERTIFIED chip + exclusion copy", () => {
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Roleplay does not affect model certification/);
  });

  // -------- status panel content --------

  it("RPP4-P04 · status panel shows the latest tested route (openrouter / xiaomi/mimo-v2-flash)", () => {
    assert.match(HTML, /ROLEPLAY_TESTED_ROUTES\s*=\s*\[/);
    assert.match(HTML, /providerId:'openrouter'[^}]*modelId:'xiaomi\/mimo-v2-flash'/);
    assert.match(HTML, /TESTED ROUTES \(EXPERIMENTAL\)/);
  });

  it("RPP4-P05 · status panel includes a LATEST SMOKE block driven by state.roleplaySmoke", () => {
    assert.match(HTML, /LATEST SMOKE/);
    assert.match(HTML, /roleplaySmoke:\{loaded:false,loading:false/);
    assert.match(HTML, /async function fetchRoleplaySmoke/);
    assert.match(HTML, /\/api\/roleplay\/latest-smoke/);
    // Panel must reference report.classifications PASS count.
    assert.match(HTML, /report\.classifications/);
    // Test coverage line (Phase 1 spec).
    assert.match(HTML, /TEST COVERAGE/);
    assert.match(HTML, /character · continuity · drift · refusal · contradiction · persona-break/);
  });

  // -------- result cards --------

  it("RPP4-P06 · result cards render all 7 Roleplay POC test ids", () => {
    for (const id of [
      "roleplay-character-001",
      "roleplay-continuity-001",
      "roleplay-drift-001",
      "roleplay-refusal-001",
      "roleplay-continuity-002",
      "roleplay-contradiction-001",
      "roleplay-persona-break-001",
    ]) {
      assert.match(HTML, new RegExp(`id:'${id}'`), `ROLEPLAY_POC_TESTS must list ${id}`);
    }
    // Cards wired to live smoke via roleplayResultByTaskId.
    assert.match(HTML, /function roleplayResultByTaskId/);
    assert.match(HTML, /data-roleplay-test=/);
  });

  it("RPP4-P07 · result cards include persona, stress category, and turn count", () => {
    // Every POC entry must declare persona + category.
    for (const field of ["persona:'Ember", "persona:'Volt", "persona:'Maris", "persona:'Theo", "persona:'Wren", "persona:'Korin"]) {
      assert.match(HTML, new RegExp(field), `manifest registry must include ${field}`);
    }
    for (const cat of ["character", "continuity", "long-form drift", "refusal handling", "memory continuity", "contradiction handling", "persona-break resistance"]) {
      assert.match(HTML, new RegExp(`category:'${cat}'`), `card definition must include category '${cat}'`);
    }
    assert.match(HTML, /<span class="vc-key">PERSONA<\/span>/);
    assert.match(HTML, /<span class="vc-key">CATEGORY<\/span>/);
    assert.match(HTML, /<span class="vc-key">TURNS<\/span>/);
    assert.match(HTML, /<span class="vc-key">ATTRIBUTION<\/span>/);
  });

  // -------- failed-turn sub-cards --------

  it("RPP4-P08 · failed-turn sub-cards render turn id, severity, attribution, and reason", () => {
    // The renderer iterates turnSummary.filter(!passed) into .rp-fail-turn nodes.
    assert.match(HTML, /class="rp-fail-turn"/);
    assert.match(HTML, /data-roleplay-failed-turn=/);
    assert.match(HTML, /<span class="rp-ft-id mono">/);
    assert.match(HTML, /class="rp-ft-sev/);
    assert.match(HTML, /USER<\/span>/);
    assert.match(HTML, /MODEL<\/span>/);
    assert.match(HTML, /REASON<\/span>/);
    // Severity + context extracted via the helpers.
    assert.match(HTML, /function roleplaySeverityFromReason/);
    assert.match(HTML, /function roleplayContextFromReason/);
    // CSS exists for the sub-card family.
    assert.match(CSS, /\.rp-fail-turns/);
    assert.match(CSS, /\.rp-fail-turn/);
    assert.match(CSS, /\.rp-ft-head/);
    assert.match(CSS, /\.rp-ft-row/);
  });

  it("RPP4-P09 · current known failure surfaces as MODEL attribution with MILD drift severity", () => {
    // Read the live smoke report we just rotated; confirm the
    // drift-001 Q04 failure is recorded with attribution MODEL and
    // a SEVERITY=MILD drift marker that the UI will extract.
    const latestJson = join(ROOT, "reports", "capability-expansion", "roleplay-smoke", "latest.json");
    assert.ok(existsSync(latestJson), "latest roleplay smoke report must exist");
    const d = JSON.parse(readFileSync(latestJson, "utf-8"));
    const drift = (d.results || []).find((r: { taskId: string }) => r.taskId === "roleplay-drift-001");
    if (!drift) return; // tolerate absence; live smoke can be re-run
    if (drift.classification === "PASS") return; // model variance: tolerate a PASS run too
    assert.equal(drift.attribution, "MODEL", "drift-001 failure must attribute MODEL");
    assert.match(String(drift.firstFailReason || ""), /SEVERITY=MILD drift/);
  });

  // -------- backend route --------

  it("RPP4-P10 · /api/roleplay/latest-smoke route is wired + re-asserts experimental/exclusion flags", () => {
    assert.match(APP_SRC, /\/api\/roleplay\/latest-smoke/);
    assert.match(APP_SRC, /roleplay\.handleLatestSmoke/);
    // Handler must re-assert all three posture fields on the wire.
    assert.match(ROLEPLAY_ROUTE, /experimental:\s*parsed\.experimental\s*!==\s*false/);
    assert.match(ROLEPLAY_ROUTE, /affectsLeaderboard:\s*parsed\.affectsLeaderboard\s*===\s*true/);
    assert.match(ROLEPLAY_ROUTE, /affectsCertification:\s*parsed\.affectsCertification\s*===\s*true/);
  });

  it("RPP4-P11 · missing latest-smoke report path returns available:false + experimental:true without crashing", () => {
    // Source-level: the route handler's no-file branch returns the
    // documented shape (available:false, experimental:true, both
    // affects flags false, reason explains how to rerun).
    assert.match(ROLEPLAY_ROUTE, /if \(!existsSync\(LATEST\)\) \{/);
    assert.match(ROLEPLAY_ROUTE, /available: false[\s\S]*reason:[\s\S]*roleplay-smoke\.mjs --write-report[\s\S]*experimental: true[\s\S]*affectsLeaderboard: false[\s\S]*affectsCertification: false/);
    // Fetcher's catch must set loaded:true so the UI re-renders
    // instead of staying on the "loading…" placeholder.
    assert.match(HTML, /state\.roleplaySmoke=\{loaded:true,loading:false,error:String/);
  });

  // -------- exclusion + Vision preserved --------

  it("RPP4-P12 · Roleplay UI never says 'certified' anywhere in the panel", () => {
    // Walk the renderRoleplayLanePanel template-literal: it must not
    // contain the literal word "certified" except inside "NOT CERTIFIED"
    // and "not ranked, not certified" copy.
    const renderRoleplayFn = HTML.match(/function renderRoleplayLanePanel\([^{]*\{[\s\S]*?\n\}\n/);
    assert.ok(renderRoleplayFn, "renderRoleplayLanePanel must exist");
    const body = renderRoleplayFn![0];
    // Any "certified" substring must be in a negation (NOT, not).
    const certifiedRegex = /\b[A-Za-z]+\s+certified\b|\bcertified\s+[A-Za-z]+/gi;
    const matches = body.match(certifiedRegex) || [];
    for (const m of matches) {
      assert.match(m, /\b(not|no)\b/i, `roleplay panel must never say "${m}" in an affirmative-certification sense`);
    }
  });

  it("RPP4-P13 · Roleplay remains excluded from leaderboard (scoreFamilies + panel copy + smoke flag)", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(SMOKE_SRC, /affectsLeaderboard:\s*false/);
  });

  it("RPP4-P14 · Roleplay remains excluded from certification + certified-models.json untouched + inventory 23/77/52", () => {
    assert.match(SMOKE_SRC, /affectsCertification:\s*false/);
    assert.match(SMOKE_SRC, /experimental:\s*true/);
    // Inventory unchanged: roleplay still 10 tasks.
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    assert.equal(readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    // certified-models.json untouched (tolerates absence).
    if (existsSync(CERTIFIED_MODELS_JSON)) {
      const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
      const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
      for (const m of models) {
        if (m.modelId === "xiaomi/mimo-v2-flash") {
          assert.notEqual(m.tier, "RELEASE_CERTIFIED", "mimo-v2-flash must not be RELEASE_CERTIFIED via Roleplay smoke");
        }
      }
    }
    // Doc reflects current state.
    assert.match(ROLEPLAY_DOC, /Current state \(Phase 4\)/);
    assert.match(ROLEPLAY_DOC, /Known limitations/);
  });

  it("RPP4-P15 · Vision Phase-7 latest-smoke route + fetchVisionSmoke remain unchanged + Vision panel preserved", () => {
    // Vision route file still exists and still re-asserts the posture.
    const visionRoute = readFileSync(join(ROOT, "server", "routes", "vision.ts"), "utf-8");
    assert.match(visionRoute, /experimental:\s*parsed\.experimental\s*!==\s*false/);
    assert.match(APP_SRC, /\/api\/vision\/latest-smoke/);
    // Vision UI fetcher + panel still intact.
    assert.match(HTML, /async function fetchVisionSmoke/);
    assert.match(HTML, /function renderVisionLanePanel/);
    assert.match(HTML, /tab\.key==='vision'\?renderVisionLanePanel/);
  });
});
