import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { TaskManifest } from "../adapters/base.js";
import { resolveOraclePath } from "../core/oracle.js";

function orchestrationManifests(): Array<{ path: string; manifest: TaskManifest }> {
  const base = join("tasks", "orchestration");
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(base, entry.name, "manifest.json");
      return { path, manifest: JSON.parse(readFileSync(path, "utf-8")) as TaskManifest };
    });
}

function commandPath(commandText: string): string | null {
  const match = commandText.match(/^node\s+([^\s]+)$/);
  return match?.[1] ?? null;
}

function isForbidden(path: string, forbiddenPaths: string[]): boolean {
  return forbiddenPaths.some((forbidden) => path === forbidden || path.startsWith(`${forbidden.replace(/\/$/, "")}/`));
}

describe("build fixture audit", () => {
  it("keeps every orchestration fixture wired to a valid repo, public test, and hidden oracle", () => {
    const fixtures = orchestrationManifests();
    assert.equal(fixtures.length, 4, "expected the four build/orchestration fixtures");

    for (const { path, manifest } of fixtures) {
      const fixtureDir = dirname(path);
      const repoDir = join(fixtureDir, "repo");

      assert.equal(manifest.family, "orchestration", `${manifest.id}: family`);
      assert.ok(manifest.task.description.trim().length >= 30, `${manifest.id}: task description`);
      assert.ok(existsSync(join(repoDir, "package.json")), `${manifest.id}: repo package.json exists`);
      assert.ok(manifest.verification.public_tests_command?.trim(), `${manifest.id}: public test command`);
      assert.equal(manifest.verification.build_command ?? null, null, `${manifest.id}: no separate build command; public/hidden node tests are authoritative`);

      const publicPath = commandPath(manifest.verification.public_tests_command!);
      assert.ok(publicPath, `${manifest.id}: public test command must be a direct node test command`);
      assert.ok(existsSync(join(repoDir, publicPath!)), `${manifest.id}: public test exists at ${publicPath}`);

      const oraclePath = resolveOraclePath(manifest);
      assert.ok(existsSync(oraclePath), `${manifest.id}: oracle exists at ${relative(process.cwd(), oraclePath)}`);
      const oracle = JSON.parse(readFileSync(oraclePath, "utf-8"));
      assert.equal(oracle.task_id, manifest.id, `${manifest.id}: oracle id matches fixture`);
      const hiddenCommand = oracle.checks.correctness.find((check: { type: string; command?: string }) => check.type === "hidden_test")?.command;
      assert.ok(hiddenCommand?.trim(), `${manifest.id}: hidden test command`);
      const hiddenPath = commandPath(hiddenCommand!);
      assert.ok(hiddenPath, `${manifest.id}: hidden test command must be a direct node test command`);
      assert.ok(existsSync(join(repoDir, hiddenPath!)), `${manifest.id}: hidden oracle test exists at ${hiddenPath}`);
      const oraclePublicCommand = oracle.checks.regression.find((check: { type: string; command?: string }) => check.type === "test_suite")?.command;
      assert.deepEqual(oraclePublicCommand, manifest.verification.public_tests_command, `${manifest.id}: manifest and oracle public commands match`);
    }
  });

  it("keeps orchestration scoring and edit constraints aligned with fixture metadata", () => {
    for (const { manifest } of orchestrationManifests()) {
      const oraclePath = resolveOraclePath(manifest);
      const oracle = JSON.parse(readFileSync(oraclePath, "utf-8"));
      const bugLocations = Array.isArray(oracle.ground_truth.bug_location)
        ? oracle.ground_truth.bug_location as string[]
        : [oracle.ground_truth.bug_location as string];
      const fixPatterns = Array.isArray(oracle.ground_truth.correct_fix_pattern)
        ? oracle.ground_truth.correct_fix_pattern as string[]
        : [oracle.ground_truth.correct_fix_pattern as string];
      const weights = manifest.scoring.weights;
      const totalWeight = weights.correctness + weights.regression + weights.integrity + weights.efficiency;
      assert.ok(Math.abs(totalWeight - 1) < 0.0001, `${manifest.id}: scoring weights sum to 1`);
      assert.ok(manifest.scoring.pass_threshold > 0 && manifest.scoring.pass_threshold <= 1, `${manifest.id}: pass threshold`);

      assert.ok(bugLocations.every((location) => location.trim()), `${manifest.id}: expected bug location`);
      assert.ok(fixPatterns.every((pattern) => pattern.trim()), `${manifest.id}: expected fix goal recorded`);
      assert.ok(bugLocations.some((location) => manifest.task.entrypoints.includes(location) || manifest.task.entrypoints.some((entry) => entry.startsWith("tests/"))), `${manifest.id}: expected bug can be discovered from agent-visible entrypoints`);
      for (const bugLocation of bugLocations) {
        assert.equal(isForbidden(bugLocation, manifest.constraints.forbidden_paths), false, `${manifest.id}: safe edit path is not forbidden`);
      }

      assert.ok(oracle.checks.integrity.some((check: { id: string; type: string }) => check.id === "no-test-modification" || check.type === "forbidden_edit"), `${manifest.id}: prevents public/hidden test edits`);
      assert.ok(oracle.checks.integrity.some((check: { id: string; rule?: string }) => check.id === "no-test-deletion" || check.rule === "no_file_deletion"), `${manifest.id}: prevents deleting fixtures`);
      assert.doesNotMatch(JSON.stringify(manifest.task), /correct_fix_pattern|hidden_tests_command|oracle_ref|gold_solution/i, `${manifest.id}: hidden scoring details are not leaked in prompt task`);
    }
  });

  it("documents current multi-file and prose-rubric limitations explicitly for build fixtures", () => {
    const coord3 = orchestrationManifests().find((entry) => entry.manifest.id === "coord-003")?.manifest;
    const coord4 = orchestrationManifests().find((entry) => entry.manifest.id === "coord-004")?.manifest;
    assert.ok(coord3, "coord-003 present");
    assert.ok(coord4, "coord-004 present");
    assert.equal(coord3!.task.entrypoints.length > 1, true, "coord-003 intentionally requires two files");
    const oracle = JSON.parse(readFileSync(resolveOraclePath(coord4!), "utf-8"));
    assert.match(String(oracle.ground_truth.correct_fix_pattern), /move content\.split|Set/i, "coord-004 records a prose optimization target");
  });
});
