import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBundle } from "../core/bundle.js";
import { generateBundleId } from "../core/identity.js";

function makeMinimalInput(overrides: { taskId?: string; model?: string; startTime?: string } = {}) {
  const taskId = overrides.taskId ?? "task.alpha-1";
  const model = overrides.model ?? "provider/model:variant";
  const startTime = overrides.startTime ?? "2026-06-30T12:34:56.789Z";
  return {
    manifest: {
      id: taskId,
      family: "spec_discipline",
      difficulty: "medium",
      metadata: { benchmark_provenance: null },
      scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
      task: { title: "test" },
      constraints: {},
      verification: {},
    },
    oracle: { expected_files: {}, expected_behavior: "" },
    executionResult: {
      timeline: [],
      tokens_in: 0,
      tokens_out: 0,
      exit_reason: "complete" as const,
      adapter_metadata: { system_version: "test", provider: "local" },
    },
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    judgeResult: {
      verification: {
        correctness: { score: 1, details: {} },
        regression: { score: 1, details: {} },
        integrity: { score: 1, violations: [], details: {} },
        efficiency: { score: 1, details: {} },
      },
      diagnosis: { failure_mode: null, root_cause: null, suggested_fix: null },
    },
    security: { injection_scan: "clean" as const, forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    startTime,
    endTime: startTime,
    workspace: { commit: "abc123", path: "/tmp/test" },
    adapter: {
      id: "test",
      version: "1.0.0",
      name: "Test",
      supportsToolCalls: () => false,
      supportsChat: () => false,
      init: async () => {},
      healthCheck: async () => ({ ok: true }),
      execute: async () => ({}),
      teardown: async () => {},
    },
    model,
  };
}

function parseBundleId(id: string): { date: string; taskId: string; modelSlug: string; suffix: string } {
  const match = /^run_(\d{4}-\d{2}-\d{2})_(.+)_(.+)_([a-f0-9]{8}|[a-f0-9]{16})$/.exec(id);
  assert.ok(match, `bundle id should be parseable: ${id}`);
  return {
    date: match[1]!,
    taskId: match[2]!,
    modelSlug: match[3]!,
    suffix: match[4]!,
  };
}

describe("bundle id filesystem properties", () => {
  it("sanitizes provider/model separators into a single filesystem path segment", () => {
    const bundle = buildBundle(makeMinimalInput({
      taskId: "task.alpha-1",
      model: "provider/family:model.v1",
    }) as never);

    const parsed = parseBundleId(bundle.bundle_id);
    assert.equal(parsed.date, "2026-06-30");
    assert.equal(parsed.taskId, "task.alpha-1");
    assert.equal(parsed.modelSlug, "provider-family-model.v1");
    assert.doesNotMatch(bundle.bundle_id, /[/:\\]/, "bundle id must not contain path separators or URL separators");
  });

  it("concurrent bundle creation for the same date/task/model does not collide", async () => {
    const inputs = Array.from({ length: 100 }, () => makeMinimalInput({
      taskId: "task.concurrent",
      model: "provider/model:variant",
      startTime: "2026-06-30T00:00:00.000Z",
    }));

    const bundles = await Promise.all(inputs.map(async (input) => buildBundle(input as never)));
    const ids = bundles.map((b) => b.bundle_id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.match(id, /^run_2026-06-30_task\.concurrent_provider-model-variant_[a-f0-9]{8}$/);
    }
  });

  it("bundle id format is stable and parseable", () => {
    const id = generateBundleId("op-001", "openrouter/model:v1", { isoDate: "2026-06-30T23:59:59.999Z" });
    const parsed = parseBundleId(id);

    assert.equal(parsed.date, "2026-06-30");
    assert.equal(parsed.taskId, "op-001");
    assert.equal(parsed.modelSlug, "openrouter-model-v1");
    assert.match(parsed.suffix, /^[a-f0-9]{8}$/);
  });
});
