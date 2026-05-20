/**
 * Crucible — Lane → family drift guard.
 *
 * The lane → task-family mapping currently lives in two places:
 *   • ui/index.html      → TAB_CONFIG (drives the tab list, scope filters,
 *                          UI fetches, and the leaderboard slicing path)
 *   • scripts/lane-diagnostic.mjs → LANES (drives the operator-facing
 *                          diagnostic the audit relies on)
 *
 * Extracting this to a single shared module is a build change we don't
 * want to land alongside the release-candidate hardening pass. Instead
 * this test reads both files at runtime and asserts they describe the
 * same lanes with the same families. Any drift fails the suite loudly.
 *
 * If a future PR splits a lane / renames a family / adds a new lane, both
 * sources must move together — otherwise the diagnostic stops measuring
 * what the UI actually shows.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();

// ── UI extraction ────────────────────────────────────────────────────────

function loadUiTabConfig(): Record<string, { taskFamilies: string[]; isSettings?: boolean }> {
  const uiPath = join(ROOT, "ui", "index.html");
  const html = readFileSync(uiPath, "utf-8");
  const match = html.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
  assert.ok(match, "ui/index.html must contain a <script> block");
  const script = match![1]!;
  // Carve out the TAB_CONFIG object literal — the constant is small and
  // unambiguous, so a targeted regex is safer than executing the whole
  // 3500-line script.
  const cfgMatch = script.match(/const\s+TAB_CONFIG\s*=\s*\{[\s\S]*?\n\};/);
  assert.ok(cfgMatch, "ui/index.html must declare TAB_CONFIG");
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(`${cfgMatch![0]} globalThis.__cfg = TAB_CONFIG;`, sandbox, { filename: "ui/index.html::TAB_CONFIG" });
  return (sandbox as { __cfg: Record<string, { taskFamilies: string[]; isSettings?: boolean }> }).__cfg;
}

// ── Diagnostic extraction ────────────────────────────────────────────────

function loadDiagnosticLanes(): Record<string, string[]> {
  const path = join(ROOT, "scripts", "lane-diagnostic.mjs");
  const source = readFileSync(path, "utf-8");
  const lanesMatch = source.match(/const\s+LANES\s*=\s*\{[\s\S]*?\n\};/);
  assert.ok(lanesMatch, "scripts/lane-diagnostic.mjs must declare LANES");
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(`${lanesMatch![0]} globalThis.__lanes = LANES;`, sandbox, { filename: "scripts/lane-diagnostic.mjs::LANES" });
  return (sandbox as { __lanes: Record<string, string[]> }).__lanes;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("lane → family mapping does not drift between UI and diagnostic", () => {
  it("every diagnostic lane key matches a UI tab key", () => {
    const ui = loadUiTabConfig();
    const diag = loadDiagnosticLanes();
    for (const lane of Object.keys(diag)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ui, lane),
        `diagnostic lane "${lane}" has no matching UI tab — drop the lane or add it to ui/index.html TAB_CONFIG`,
      );
    }
  });

  it("every UI lane tab (non-settings, non-dashboard) has a diagnostic entry", () => {
    const ui = loadUiTabConfig();
    const diag = loadDiagnosticLanes();
    for (const [tabKey, cfg] of Object.entries(ui)) {
      if (tabKey === "dashboard" || cfg.isSettings) continue;
      assert.ok(
        Object.prototype.hasOwnProperty.call(diag, tabKey),
        `UI lane "${tabKey}" has no diagnostic entry — add it to scripts/lane-diagnostic.mjs LANES`,
      );
    }
  });

  it("each shared lane key declares the same task families in both files", () => {
    const ui = loadUiTabConfig();
    const diag = loadDiagnosticLanes();
    for (const lane of Object.keys(diag)) {
      const uiFamilies = [...(ui[lane]?.taskFamilies ?? [])].sort();
      const diagFamilies = [...(diag[lane] ?? [])].sort();
      assert.deepEqual(
        diagFamilies,
        uiFamilies,
        `lane "${lane}" diverges between ui/index.html (${uiFamilies.join(",")}) and scripts/lane-diagnostic.mjs (${diagFamilies.join(",")})`,
      );
    }
  });

  it("UI tab families remain mutually disjoint (no run can render in two lanes)", () => {
    const ui = loadUiTabConfig();
    const seen = new Map<string, string>();
    for (const [tabKey, cfg] of Object.entries(ui)) {
      if (tabKey === "dashboard" || cfg.isSettings) continue;
      for (const family of cfg.taskFamilies) {
        const prior = seen.get(family);
        assert.equal(prior, undefined, `family "${family}" appears in both ${prior} and ${tabKey}`);
        seen.set(family, tabKey);
      }
    }
  });
});
