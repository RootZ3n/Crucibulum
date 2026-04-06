/**
 * Crucibulum — Adapter Tests
 * Covers: mock adapter contract, OllamaAdapter construction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OllamaAdapter } from "../adapters/ollama.js";
// ── Mock Adapter ────────────────────────────────────────────────────────────
class MockAdapter {
    id = "mock";
    name = "Mock";
    version = "1.0.0";
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return false;
    }
    async init(_config) {
        // no-op
    }
    async healthCheck() {
        return { ok: true };
    }
    async teardown() {
        // no-op
    }
    async execute(input) {
        return {
            exit_reason: "complete",
            timeline: [
                { t: 0, type: "task_start", detail: "mock start" },
                { t: 1, type: "task_complete", detail: "mock complete" },
            ],
            duration_ms: 1000,
            steps_used: 2,
            files_read: [],
            files_written: [],
            tokens_in: 100,
            tokens_out: 50,
            adapter_metadata: {
                adapter_id: "mock",
                adapter_version: "1.0.0",
                system_version: "mock-1.0",
                model: "mock-model",
                provider: "local",
            },
        };
    }
}
// ── Mock adapter contract ───────────────────────────────────────────────────
describe("mock adapter contract", () => {
    it("has all required interface methods", () => {
        const adapter = new MockAdapter();
        assert.equal(typeof adapter.id, "string");
        assert.equal(typeof adapter.name, "string");
        assert.equal(typeof adapter.version, "string");
        assert.equal(typeof adapter.supports, "function");
        assert.equal(typeof adapter.supportsToolCalls, "function");
        assert.equal(typeof adapter.init, "function");
        assert.equal(typeof adapter.healthCheck, "function");
        assert.equal(typeof adapter.teardown, "function");
        assert.equal(typeof adapter.execute, "function");
    });
    it("execute returns proper result shape", async () => {
        const adapter = new MockAdapter();
        const input = {
            task: {
                task: { title: "test", description: "test", entrypoints: [] },
                constraints: { time_limit_sec: 60, max_steps: 10, allowed_tools: [], network_allowed: false },
                verification: { public_tests_command: null, build_command: null },
            },
            workspace_path: "/tmp/test",
            budget: { time_limit_sec: 60, max_steps: 10, max_file_edits: 5, network_allowed: false },
        };
        const result = await adapter.execute(input);
        assert.ok(["complete", "timeout", "budget_exceeded", "error", "injection_detected"].includes(result.exit_reason));
        assert.ok(Array.isArray(result.timeline));
        assert.equal(typeof result.duration_ms, "number");
        assert.equal(typeof result.steps_used, "number");
        assert.ok(Array.isArray(result.files_read));
        assert.ok(Array.isArray(result.files_written));
        assert.equal(typeof result.adapter_metadata.adapter_id, "string");
        assert.equal(typeof result.adapter_metadata.provider, "string");
    });
    it("healthCheck returns ok shape", async () => {
        const adapter = new MockAdapter();
        const health = await adapter.healthCheck();
        assert.equal(typeof health.ok, "boolean");
        assert.equal(health.ok, true);
    });
});
// ── OllamaAdapter construction ──────────────────────────────────────────────
describe("OllamaAdapter", () => {
    it("implements all required interface properties and methods", () => {
        const adapter = new OllamaAdapter();
        assert.equal(typeof adapter.id, "string");
        assert.equal(typeof adapter.name, "string");
        assert.equal(typeof adapter.version, "string");
        assert.equal(typeof adapter.supports, "function");
        assert.equal(typeof adapter.supportsToolCalls, "function");
        assert.equal(typeof adapter.init, "function");
        assert.equal(typeof adapter.healthCheck, "function");
        assert.equal(typeof adapter.teardown, "function");
        assert.equal(typeof adapter.execute, "function");
    });
    it("supports all families", () => {
        const adapter = new OllamaAdapter();
        assert.equal(adapter.supports("poison"), true);
        assert.equal(adapter.supports("spec"), true);
        assert.equal(adapter.supports("orchestration"), true);
    });
    it("init accepts config without error", async () => {
        const adapter = new OllamaAdapter();
        await adapter.init({ timeout_ms: 5000 });
        // Should not throw
        assert.ok(true);
    });
    it("teardown completes without error", async () => {
        const adapter = new OllamaAdapter();
        await adapter.teardown();
        assert.ok(true);
    });
});
//# sourceMappingURL=adapters.test.js.map