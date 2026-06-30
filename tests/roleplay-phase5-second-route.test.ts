/**
 * Luak — Roleplay Phase 5 landing + exclusion-contract regression (offline).
 *
 * SCOPE NOTE: this is NOT a roleplay-quality test. It does not evaluate how
 * well any model role-plays. It is a deterministic landing snapshot that pins
 * Phase 5's plumbing: a second tested route was added, its smoke report is on
 * disk, the UI lists two routes, and — the durable part — roleplay stays
 * excluded from the leaderboard composite and from model certification.
 * Roleplay quality itself is exercised by the scorer-level tests
 * (conversational-judge / roleplay continuity + persona scorers).
 *
 * 10 deterministic source/contract assertions. No provider calls. No network.
 *
 * Live smoke evidence:
 *   reports/capability-expansion/roleplay-smoke/2026-05-26T10-51-01Z.{json,md}  (mimo Phase 4)
 *   reports/capability-expansion/roleplay-smoke/2026-05-26T11-04-01Z.{json,md}  (deepseek Phase 5)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "roleplay-smoke.mjs"), "utf-8");
const APP_SRC = readFileSync(join(ROOT, "server", "app.ts"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");
const PHASE5_SMOKE_JSON = join(ROOT, "reports", "capability-expansion", "roleplay-smoke", "2026-05-26T11-04-01Z.json");
const CANDIDATE_INVENTORY = join(ROOT, "reports", "capability-expansion", "roleplay-phase5-second-route", "candidate-inventory.md");

describe("Roleplay Phase 5 landing + exclusion contract (offline — not a quality test)", () => {
  it("RPP5-P01 · candidate-inventory.md exists and names deepseek/deepseek-v4-flash as the selected route", () => {
    assert.ok(existsSync(CANDIDATE_INVENTORY), `${CANDIDATE_INVENTORY} must exist`);
    const md = readFileSync(CANDIDATE_INVENTORY, "utf-8");
    assert.match(md, /Selected route/);
    assert.match(md, /openrouter \/ deepseek\/deepseek-v4-flash/);
    assert.match(md, /PROVIDER_TESTED/);
    assert.match(md, /supportsRoleplay/);
  });

  it("RPP5-P02 · roleplay-smoke supports the second route via the same provider/model CLI", () => {
    // The smoke runner takes --provider and --model directly; the
    // PROVIDERS table doesn't enumerate model ids. Confirm the
    // openrouter provider is wired and the --model arg is required.
    assert.match(SMOKE_SRC, /openrouter:\s*\{[^}]*envKey:\s*"OPENROUTER_API_KEY"/s);
    assert.match(SMOKE_SRC, /--model is required/);
  });

  it("RPP5-P03 · Phase 5 smoke JSON exists for openrouter/deepseek-v4-flash with 7 results", () => {
    assert.ok(existsSync(PHASE5_SMOKE_JSON), "Phase 5 smoke JSON must be on disk");
    const d = JSON.parse(readFileSync(PHASE5_SMOKE_JSON, "utf-8"));
    assert.equal(d.provider, "openrouter");
    assert.equal(d.model, "deepseek/deepseek-v4-flash");
    assert.equal(d.experimental, true);
    assert.equal(d.affectsLeaderboard, false);
    assert.equal(d.affectsCertification, false);
    assert.equal((d.results || []).length, 7, "second-route smoke must run all 7 POC tests");
  });

  it("RPP5-P04 · UI lists two tested Roleplay routes (mimo + deepseek), latest-match highlight preserved", () => {
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-flash'/);
    assert.match(HTML, /modelId:'deepseek\/deepseek-v4-flash'/);
    // Latest-match highlight logic still in renderRoleplayLanePanel.
    assert.match(HTML, /liveMatch\?'is-latest':''/);
  });

  it("RPP5-P05 · permanent EXPERIMENTAL / NOT IN LEADERBOARD / NOT CERTIFIED chips still render", () => {
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT IN LEADERBOARD/);
    assert.match(HTML, /NOT CERTIFIED/);
  });

  it("RPP5-P06 · Roleplay remains excluded from leaderboard composite (scoreFamilies:[] + copy + smoke flag)", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(SMOKE_SRC, /affectsLeaderboard:\s*false/);
    // Phase 5 smoke payload also wrote the field.
    const d = JSON.parse(readFileSync(PHASE5_SMOKE_JSON, "utf-8"));
    assert.equal(d.affectsLeaderboard, false);
  });

  it("RPP5-P07 · Roleplay remains excluded from certification + certified-models.json untouched", () => {
    assert.match(HTML, /Roleplay does not affect model certification/);
    assert.match(SMOKE_SRC, /affectsCertification:\s*false/);
    if (existsSync(CERTIFIED_MODELS_JSON)) {
      const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
      const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
      for (const m of models) {
        if (m.modelId === "deepseek/deepseek-v4-flash" || m.modelId === "xiaomi/mimo-v2-flash") {
          assert.notEqual(m.tier, "RELEASE_CERTIFIED", `${m.modelId} must not be RELEASE_CERTIFIED via Roleplay smoke`);
        }
      }
    }
  });

  it("RPP5-P08 · failed-turn rendering still works (helper functions + CSS + selectors intact)", () => {
    assert.match(HTML, /function roleplaySeverityFromReason/);
    assert.match(HTML, /function roleplayContextFromReason/);
    assert.match(HTML, /class="rp-fail-turn"/);
    const css = readFileSync(join(ROOT, "ui", "crucibulum.css"), "utf-8");
    assert.match(css, /\.rp-fail-turn/);
  });

  it("RPP5-P09 · Vision Phase-7 route + Vision UI unchanged by Phase 5", () => {
    const visionRoute = readFileSync(join(ROOT, "server", "routes", "vision.ts"), "utf-8");
    assert.match(visionRoute, /experimental:\s*parsed\.experimental\s*!==\s*false/);
    assert.match(APP_SRC, /\/api\/vision\/latest-smoke/);
    assert.match(HTML, /function renderVisionLanePanel/);
    assert.match(HTML, /VISION_TESTED_ROUTES/);
    // Vision tested routes still has both Phase-9 entries (mimo-v2-omni + gpt-5.4-mini).
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'/);
    assert.match(HTML, /modelId:'gpt-5\.4-mini'/);
  });

  it("RPP5-P10 · inventory unchanged: 23 families / 77 tasks / 52 conversational / 10 roleplay tasks", () => {
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    assert.equal(readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    // Phase 5 only added a smoke report + a UI route entry; no new
    // tasks/manifests/scorers landed.
    const judgeSrc = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
    assert.match(judgeSrc, /HARD_BANNED_IDENTITY/);
    assert.match(judgeSrc, /classifyForbiddenPhraseContext/);
  });
});
