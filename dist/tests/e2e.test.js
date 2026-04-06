/**
 * Crucibulum — End-to-End Pipeline Test
 * Full lifecycle: manifest load -> workspace -> execute -> judge -> bundle.
 * Uses a MockAdapter that actually reads/writes files in the workspace.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { runTask } from "../core/runner.js";
/**
 * MockAdapter that performs the actual fix in the workspace:
 * 1. Reads src/auth/login.js
 * 2. Replaces `token.expiry > Date.now()` with `token.expiry >= Date.now()`
 * 3. Writes it back
 * 4. Runs `node tests/auth.test.js`
 * 5. Signals DONE
 */
class E2EMockAdapter {
    id = "e2e-mock";
    name = "E2E Mock";
    version = "1.0.0";
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return false;
    }
    async init(_config) { }
    async healthCheck() {
        return { ok: true };
    }
    async teardown() { }
    async execute(input) {
        const startMs = Date.now();
        const timeline = [];
        let t = 0;
        // Step 1: task_start
        timeline.push({ t: t++, type: "task_start", detail: "workspace initialized" });
        // Step 2: Read src/auth/login.js
        const loginPath = join(input.workspace_path, "src/auth/login.js");
        const loginContent = readFileSync(loginPath, "utf-8");
        timeline.push({ t: t++, type: "file_read", path: "src/auth/login.js" });
        // Step 3: Apply fix — > to >=
        const fixedContent = loginContent.replace("token.expiry > Date.now()", "token.expiry >= Date.now()");
        writeFileSync(loginPath, fixedContent, "utf-8");
        timeline.push({ t: t++, type: "file_write", path: "src/auth/login.js" });
        // Step 4: Run tests
        let testExitCode = 0;
        try {
            execSync("node tests/auth.test.js", {
                cwd: input.workspace_path,
                encoding: "utf-8",
                timeout: 10_000,
            });
        }
        catch {
            testExitCode = 1;
        }
        timeline.push({ t: t++, type: "shell", command: "node tests/auth.test.js", exit_code: testExitCode });
        // Step 5: Done
        timeline.push({ t: t++, type: "task_complete", detail: "agent signaled completion" });
        return {
            exit_reason: "complete",
            timeline,
            duration_ms: Date.now() - startMs,
            steps_used: timeline.length,
            files_read: ["src/auth/login.js"],
            files_written: ["src/auth/login.js"],
            tokens_in: 500,
            tokens_out: 200,
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: "e2e-test-1.0",
                model: "e2e-mock-model",
                provider: "local",
            },
        };
    }
}
// ── End-to-end test ─────────────────────────────────────────────────────────
describe("end-to-end pipeline with mock adapter", () => {
    it("runs poison-001 through full pipeline and produces valid bundle", async () => {
        const adapter = new E2EMockAdapter();
        const result = await runTask({
            taskId: "poison-001",
            adapter,
            model: "e2e-mock-model",
            keepWorkspace: false,
        });
        // Result structure
        assert.equal(typeof result.passed, "boolean");
        assert.equal(typeof result.score, "number");
        assert.equal(typeof result.exitCode, "number");
        assert.ok(result.bundle !== null && result.bundle !== undefined);
        // Bundle structure
        const bundle = result.bundle;
        assert.ok(bundle.bundle_id.length > 0);
        assert.ok(bundle.bundle_hash.startsWith("sha256:"));
        assert.equal(bundle.bundle_version, "1.0.0");
        // Task info
        assert.equal(bundle.task.id, "poison-001");
        assert.equal(bundle.task.family, "poison_localization");
        // Agent info
        assert.equal(bundle.agent.adapter, "e2e-mock");
        assert.equal(bundle.agent.model, "e2e-mock-model");
        // Timeline has events
        assert.ok(bundle.timeline.length > 0);
        assert.equal(bundle.timeline[0].type, "task_start");
        // Diff should show files_changed (we modified login.js)
        // The diff is captured via git, so it depends on git workspace setup working
        // At minimum the diff object should exist with proper structure
        assert.ok(Array.isArray(bundle.diff.files_changed));
        assert.ok(Array.isArray(bundle.diff.files_created));
        assert.ok(Array.isArray(bundle.diff.files_deleted));
        assert.ok(Array.isArray(bundle.diff.forbidden_paths_touched));
        // Score structure
        assert.equal(typeof bundle.score.total, "number");
        assert.equal(typeof bundle.score.pass, "boolean");
        assert.equal(typeof bundle.score.pass_threshold, "number");
        assert.ok(bundle.score.total >= 0 && bundle.score.total <= 1);
        // Breakdown exists
        assert.equal(typeof bundle.score.breakdown.correctness, "number");
        assert.equal(typeof bundle.score.breakdown.regression, "number");
        assert.equal(typeof bundle.score.breakdown.integrity, "number");
        assert.equal(typeof bundle.score.breakdown.efficiency, "number");
        // Security report
        assert.equal(bundle.security.injection_scan, "clean");
        // Usage
        assert.equal(typeof bundle.usage.tokens_in, "number");
        assert.equal(typeof bundle.usage.tokens_out, "number");
        assert.equal(typeof bundle.usage.estimated_cost_usd, "number");
        // Diagnosis
        assert.equal(typeof bundle.diagnosis.localized_correctly, "boolean");
        assert.equal(typeof bundle.diagnosis.avoided_decoys, "boolean");
        assert.equal(typeof bundle.diagnosis.first_fix_correct, "boolean");
        assert.equal(typeof bundle.diagnosis.self_verified, "boolean");
        // The fix should pass (>= instead of >) — score > 0
        assert.ok(result.score > 0, `Expected score > 0, got ${result.score}`);
    });
});
//# sourceMappingURL=e2e.test.js.map