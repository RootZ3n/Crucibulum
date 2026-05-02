import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBundle } from "../core/bundle.js";

describe("bundle ID collision", () => {
  it("two same-day runs at different times produce different IDs", () => {
    const makeMinimalInput = (startTime: string) => ({
      manifest: {
        id: "test-task",
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
      adapter: { id: "test", version: "1.0.0", name: "Test", supportsToolCalls: () => false, supportsChat: () => false, init: async () => {}, healthCheck: async () => ({ ok: true }), execute: async () => ({} as any), teardown: async () => {} } as any,
      model: "test-model",
    });

    const bundle1 = buildBundle(makeMinimalInput("2025-06-15T10:30:00.000Z") as any);
    const bundle2 = buildBundle(makeMinimalInput("2025-06-15T14:45:00.000Z") as any);

    assert.notEqual(bundle1.bundle_id, bundle2.bundle_id, "Bundle IDs should differ for same-day runs at different times");
    assert.match(bundle1.bundle_id, /run_\d{8}T\d{6}_/, "Bundle ID should contain date and time");
    assert.match(bundle2.bundle_id, /run_\d{8}T\d{6}_/, "Bundle ID should contain date and time");
  });
});
