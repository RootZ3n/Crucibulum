/**
 * Crucibulum — Grimoire Codex Adapter
 * Routes tasks through Squidley's Grimoire Codex mode.
 * Codex Mode = iterative inspect/edit/verify loop.
 *
 * CLI usage:
 *   --adapter grimoire-codex --model gpt-5.4
 */
import { Observer } from "../core/observer.js";
import { log } from "../utils/logger.js";
const DEFAULT_SQUIDLEY_URL = process.env["SQUIDLEY_URL"] ?? "http://localhost:18791";
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
export class GrimoireCodexAdapter {
    id = "grimoire-codex";
    name = "Grimoire Codex";
    version = "1.0.0";
    url = DEFAULT_SQUIDLEY_URL;
    model = "qwen3.6-plus";
    supports(_family) {
        return true;
    }
    supportsToolCalls() {
        return true;
    }
    supportsChat() {
        return false;
    }
    async init(config) {
        const c = config;
        if (c.squidley_url)
            this.url = c.squidley_url;
        if (c.model)
            this.model = c.model;
    }
    async healthCheck() {
        try {
            const res = await fetch(`${this.url}/health`, {
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok)
                return { ok: false, reason: `Squidley returned ${res.status}` };
            return { ok: true };
        }
        catch (err) {
            return { ok: false, reason: `Squidley unreachable: ${String(err).slice(0, 100)}` };
        }
    }
    async teardown() { }
    async execute(input) {
        const observer = new Observer();
        observer.taskStart();
        const startMs = Date.now();
        const timeLimitMs = input.budget.time_limit_sec * 1000;
        // Submit the Codex job
        log("info", "grimoire-codex", `Submitting Codex job: ${this.model}`);
        let jobId;
        try {
            const res = await fetch(`${this.url}/grimoire/codex`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    task: buildTaskPrompt(input),
                    workspace: input.workspace_path,
                    model: this.model,
                }),
                signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(`Grimoire Codex returned ${res.status}: ${errText}`);
            }
            const data = (await res.json());
            jobId = data.jobId ?? data.job_id ?? data.id ?? "";
            if (!jobId)
                throw new Error("No jobId in response");
            log("info", "grimoire-codex", `Codex job submitted: ${jobId}`);
        }
        catch (err) {
            log("error", "grimoire-codex", `Submit failed: ${String(err).slice(0, 200)}`);
            observer.recordError(`Submit failed: ${String(err).slice(0, 200)}`);
            return buildErrorResult(observer, startMs, this);
        }
        // Poll for completion
        let status = { status: "pending" };
        while (Date.now() - startMs < timeLimitMs) {
            await sleep(POLL_INTERVAL_MS);
            try {
                const res = await fetch(`${this.url}/grimoire/codex/status/${jobId}`, {
                    signal: AbortSignal.timeout(10_000),
                });
                if (!res.ok) {
                    log("warn", "grimoire-codex", `Poll returned ${res.status}`);
                    continue;
                }
                status = (await res.json());
                log("info", "grimoire-codex", `Job ${jobId}: ${status.status}`);
                if (status.status === "complete" || status.status === "error")
                    break;
            }
            catch (err) {
                log("warn", "grimoire-codex", `Poll error: ${String(err).slice(0, 100)}`);
            }
        }
        const totalDuration = Date.now() - startMs;
        if (status.status !== "complete" && status.status !== "error") {
            log("warn", "grimoire-codex", `Job timed out after ${Math.round(totalDuration / 1000)}s`);
            observer.recordError("Codex job timed out");
            return {
                exit_reason: "timeout",
                timeline: observer.getTimeline(),
                duration_ms: totalDuration,
                steps_used: observer.getStepCount(),
                files_read: [],
                files_written: [],
                tokens_in: 0,
                tokens_out: 0,
                adapter_metadata: {
                    adapter_id: this.id,
                    adapter_version: this.version,
                    system_version: "squidley-v2",
                    model: this.model,
                    provider: "grimoire-codex",
                },
            };
        }
        const result = status.result ?? {};
        const exitReason = status.status === "error" ? "error" : result.exit_reason ?? "complete";
        if (result.files_read)
            result.files_read.forEach(f => observer.fileRead(f));
        if (result.files_written)
            result.files_written.forEach(f => observer.fileWrite(f));
        if (exitReason === "complete")
            observer.taskComplete();
        log("info", "grimoire-codex", `Run complete: ${exitReason} in ${Math.round(totalDuration / 1000)}s`);
        return {
            exit_reason: exitReason,
            timeline: observer.getTimeline(),
            duration_ms: totalDuration,
            steps_used: observer.getStepCount(),
            files_read: result.files_read ?? [],
            files_written: result.files_written ?? [],
            tokens_in: result.tokensIn ?? 0,
            tokens_out: result.tokensOut ?? 0,
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: "squidley-v2",
                model: this.model,
                provider: "grimoire-codex",
            },
        };
    }
}
function buildTaskPrompt(input) {
    return [
        input.task.task.title,
        "",
        input.task.task.description,
        "",
        `Entrypoints: ${input.task.task.entrypoints.join(", ")}`,
        input.task.verification.public_tests_command ? `Tests: ${input.task.verification.public_tests_command}` : "",
        input.task.verification.build_command ? `Build: ${input.task.verification.build_command}` : "",
    ].filter(Boolean).join("\n");
}
function buildErrorResult(observer, startMs, adapter) {
    return {
        exit_reason: "error",
        timeline: observer.getTimeline(),
        duration_ms: Date.now() - startMs,
        steps_used: observer.getStepCount(),
        files_read: [],
        files_written: [],
        tokens_in: 0,
        tokens_out: 0,
        adapter_metadata: {
            adapter_id: adapter.id,
            adapter_version: adapter.version,
            system_version: "squidley-v2",
            model: "unknown",
            provider: "grimoire-codex",
        },
    };
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=grimoire-codex.js.map