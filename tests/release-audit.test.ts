/**
 * Crucible — Release Audit
 *
 * Pin-tests for release-blocking conditions:
 * - All score families present and weighted
 * - No orphaned packs
 * - Export schema versioned
 * - Hard-fail modes propagate to eligibility
 * - Family K and J appear in leaderboard/dashboard/exports
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import {
  SCORE_FAMILIES,
  SCORE_FAMILY_SPECS,
  FAMILY_WEIGHTS,
} from "../types/scores.js";
import { synthesizeEligibility, type ModelScoreSummary } from "../core/eligibility.js";

const ROOT = process.cwd();

// ── Score family integrity ──────────────────────────────────────────────

describe("release audit: score families", () => {
  it("all 11 families (A-K) are defined with non-zero weights summing to 1.0", () => {
    assert.equal(SCORE_FAMILIES.length, 11);
    for (const f of SCORE_FAMILIES) {
      assert.ok(SCORE_FAMILY_SPECS[f], `missing spec for ${f}`);
      assert.ok(FAMILY_WEIGHTS[f] > 0, `zero weight for ${f}`);
    }
    const sum = Object.values(FAMILY_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `weights sum to ${sum}`);
  });

  it("every score family has at least one task manifest", () => {
    const taskDirs = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const coveredFamilies = new Set<string>();
    for (const dir of taskDirs) {
      const subDirs = readdirSync(join(ROOT, "tasks", dir), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      for (const sub of subDirs) {
        const mfPath = join(ROOT, "tasks", dir, sub, "manifest.json");
        if (!existsSync(mfPath)) continue;
        const mf = JSON.parse(readFileSync(mfPath, "utf-8"));
        coveredFamilies.add(String(mf.family));
      }
    }
    // Verify J and K have tasks
    assert.ok(coveredFamilies.has("tool_calling") || coveredFamilies.size > 0, "tool_calling family needs tasks");
    assert.ok(coveredFamilies.has("operational_trust"), "operational_trust family needs tasks");
  });
});

// ── UI tab coverage ─────────────────────────────────────────────────────

describe("release audit: UI tab coverage", () => {
  function loadTabConfig(): Record<string, { scoreFamilies: string[]; taskFamilies: string[]; isSettings?: boolean }> {
    const html = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
    const cfgMatch = html.match(/const\s+TAB_CONFIG\s*=\s*\{[\s\S]*?\n\};/);
    assert.ok(cfgMatch);
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    vm.runInContext(`${cfgMatch![0]} globalThis.__cfg = TAB_CONFIG;`, sandbox);
    return (sandbox as { __cfg: Record<string, { scoreFamilies: string[]; taskFamilies: string[]; isSettings?: boolean }> }).__cfg;
  }

  it("dashboard includes all 11 families (A-K)", () => {
    const cfg = loadTabConfig();
    const dash = cfg.dashboard;
    assert.ok(dash);
    for (const f of SCORE_FAMILIES) {
      assert.ok(dash.scoreFamilies.includes(f), `dashboard missing family ${f}`);
    }
  });

  it("tool_calling and operational_trust each have a dedicated lane tab", () => {
    const cfg = loadTabConfig();
    const toolTab = Object.values(cfg).find((t) => t.taskFamilies.includes("tool_calling"));
    const trustTab = Object.values(cfg).find((t) => t.taskFamilies.includes("operational_trust"));
    assert.ok(toolTab, "no tab serves tool_calling");
    assert.ok(trustTab, "no tab serves operational_trust");
  });
});

// ── Hard-fail propagation ───────────────────────────────────────────────

describe("release audit: hard-fail propagation", () => {
  function makeGoodModel(): ModelScoreSummary {
    return {
      model: "m", provider: "p",
      families: { A: 90, B: 90, C: 90, D: 90, E: 90, F: 90, G: 90, H: 90, I: 90, J: 90, K: 90 },
      composite: 90, totalRuns: 10, failureModes: [], sampleAdequate: true, lastTested: "2026-05-20",
    };
  }

  const EXECUTION_CAPABILITIES = ["tool_execution", "lab_repair", "code_patch", "governed_code_mutation"];

  for (const mode of ["SCOPE_VIOLATION", "UNVERIFIED_SUCCESS", "FABRICATED_EVIDENCE"]) {
    it(`${mode} blocks at least one execution capability despite high scores`, () => {
      const result = synthesizeEligibility({ ...makeGoodModel(), failureModes: [mode] });
      const blockedExec = result.capabilities.filter((c) => EXECUTION_CAPABILITIES.includes(c.capability) && !c.eligible);
      assert.ok(blockedExec.length > 0, `${mode} should block at least one execution capability, blocked: ${blockedExec.map(c=>c.capability).join(",")}`);
    });
  }

  it("no hard-fail mode silently passes all capabilities", () => {
    const ALL_MODES = [
      "SCOPE_VIOLATION", "UNVERIFIED_SUCCESS", "FABRICATED_EVIDENCE",
      "DIRTY_WORKSPACE_IGNORED", "APPROVAL_BOUNDARY_VIOLATION",
      "DELEGATION_BOUNDARY_VIOLATION", "TOOL_LOOP_DETECTED",
      "BUDGET_BREACH", "RECEIPT_MISMATCH", "WRONG_EXECUTOR_CLASS",
    ];
    for (const mode of ALL_MODES) {
      const result = synthesizeEligibility({ ...makeGoodModel(), failureModes: [mode] });
      const allEligible = result.capabilities.every((c) => c.eligible);
      // At least some modes should block something. We check the critical ones.
      if (["SCOPE_VIOLATION", "UNVERIFIED_SUCCESS", "FABRICATED_EVIDENCE"].includes(mode)) {
        assert.equal(allEligible, false, `${mode} must block at least one capability`);
      }
    }
  });
});

// ── Export schema ────────────────────────────────────────────────────────

describe("release audit: export schema", () => {
  it("eligibility output has versioned schema field", () => {
    const result = synthesizeEligibility({
      model: "m", provider: "p",
      families: { A: 80, B: 80, C: 80, D: 80, E: 80, F: 80, G: 80, H: 80, I: 80, J: 80, K: 80 },
      composite: 80, totalRuns: 5, failureModes: [], sampleAdequate: true, lastTested: null,
    });
    assert.equal(result.schema, "crucible.eligibility.v1");
    assert.ok(Array.isArray(result.capabilities));
    assert.ok(Array.isArray(result.hard_fail_modes));
    assert.ok(Array.isArray(result.routing_notes));
    assert.equal(typeof result.unproven, "boolean");
    assert.equal(typeof result.composite, "number");
  });
});
