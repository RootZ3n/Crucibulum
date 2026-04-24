/**
 * Crucible CLI — test command
 * crucible test --model ollama:gemma3:27b --task poison-001 [--runs 3] [--output json]
 */
import { runTask } from "../../core/runner.js";
import { storeBundle } from "../../core/bundle.js";
import { OllamaAdapter } from "../../adapters/ollama.js";
import { OpenRouterAdapter } from "../../adapters/openrouter.js";
import { OpenClawAdapter } from "../../adapters/openclaw.js";
import { ClaudeCodeAdapter } from "../../adapters/claudecode.js";
import { SquidleyAdapter } from "../../adapters/squidley.js";
import { GrimoireCCAdapter } from "../../adapters/grimoire-cc.js";
import { GrimoireCodexAdapter } from "../../adapters/grimoire-codex.js";
import { AnthropicAdapter } from "../../adapters/anthropic.js";
import { OpenAIAdapter } from "../../adapters/openai.js";
import { MiniMaxAdapter } from "../../adapters/minimax.js";
import { ZAIAdapter } from "../../adapters/zai.js";
import { GoogleAdapter } from "../../adapters/google.js";
import { log } from "../../utils/logger.js";
import { formatDuration } from "../../utils/timing.js";
function parseArgs(args) {
    let model = "";
    let task = "";
    let runs = 1;
    let output = "table";
    let keepWorkspace = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];
        if (arg === "--model" && next) {
            model = next;
            i++;
        }
        else if (arg === "--task" && next) {
            task = next;
            i++;
        }
        else if (arg === "--runs" && next) {
            runs = parseInt(next, 10) || 1;
            i++;
        }
        else if (arg === "--output" && next) {
            output = next === "json" ? "json" : "table";
            i++;
        }
        else if (arg === "--keep-workspace") {
            keepWorkspace = true;
        }
    }
    if (!model) {
        console.error("Error: --model is required (e.g. --model ollama:gemma3:27b)");
        process.exit(5);
    }
    if (!task) {
        console.error("Error: --task is required (e.g. --task poison-001 or --task identity-squidley-001)");
        process.exit(5);
    }
    return { model, task, runs, output, keepWorkspace };
}
function resolveAdapter(modelSpec) {
    // Format: adapter:model e.g. ollama:gemma3:27b
    const colonIndex = modelSpec.indexOf(":");
    if (colonIndex === -1) {
        // Default to ollama
        return { adapter: new OllamaAdapter(), model: modelSpec, adapterConfig: { model: modelSpec } };
    }
    const adapterName = modelSpec.slice(0, colonIndex);
    const model = modelSpec.slice(colonIndex + 1);
    switch (adapterName) {
        case "ollama":
            return { adapter: new OllamaAdapter(), model, adapterConfig: { model } };
        case "anthropic":
            return { adapter: new AnthropicAdapter(), model, adapterConfig: { model } };
        case "openai":
            return { adapter: new OpenAIAdapter(), model, adapterConfig: { model } };
        case "openrouter":
            return { adapter: new OpenRouterAdapter(), model, adapterConfig: { model } };
        case "openclaw":
            return { adapter: new OpenClawAdapter(), model: model || "default", adapterConfig: { model: model || undefined } };
        case "claudecode":
        case "claude":
            return { adapter: new ClaudeCodeAdapter(), model, adapterConfig: { model: model || undefined, binary_path: undefined } };
        case "squidley":
            return { adapter: new SquidleyAdapter(), model, adapterConfig: { model, squidley_url: process.env["SQUIDLEY_URL"] || undefined } };
        case "grimoire-cc":
            return { adapter: new GrimoireCCAdapter(), model, adapterConfig: { model, squidley_url: process.env["SQUIDLEY_URL"] || undefined } };
        case "grimoire-codex":
            return { adapter: new GrimoireCodexAdapter(), model, adapterConfig: { model, squidley_url: process.env["SQUIDLEY_URL"] || undefined } };
        case "minimax":
            return { adapter: new MiniMaxAdapter(), model, adapterConfig: { model } };
        case "zai":
            return { adapter: new ZAIAdapter(), model, adapterConfig: { model } };
        case "google":
            return { adapter: new GoogleAdapter(), model, adapterConfig: { model } };
        default:
            console.error(`Unknown adapter: ${adapterName}. Available: ollama, anthropic, openai, openrouter, openclaw, claudecode, squidley, grimoire-cc, grimoire-codex, minimax, zai, google`);
            process.exit(5);
    }
}
export async function testCommand(args) {
    const opts = parseArgs(args);
    const { adapter, model, adapterConfig } = resolveAdapter(opts.model);
    log("info", "cli", `Crucible test: ${opts.task} × ${model} (${opts.runs} run${opts.runs > 1 ? "s" : ""})`);
    // Init adapter
    await adapter.init(adapterConfig);
    // Health check
    const health = await adapter.healthCheck();
    if (!health.ok) {
        console.error(`Adapter health check failed: ${health.reason ?? "unknown"}`);
        process.exit(5);
    }
    const results = [];
    for (let run = 1; run <= opts.runs; run++) {
        if (opts.runs > 1)
            log("info", "cli", `── Run ${run}/${opts.runs} ──`);
        const result = await runTask({
            taskId: opts.task,
            adapter,
            model,
            keepWorkspace: opts.keepWorkspace,
        });
        // Store the evidence bundle
        const bundlePath = storeBundle(result.bundle);
        results.push({
            run,
            score: result.score,
            passed: result.passed,
            bundleId: result.bundle.bundle_id,
            duration: formatDuration(result.bundle.environment.timestamp_end
                ? new Date(result.bundle.environment.timestamp_end).getTime() - new Date(result.bundle.environment.timestamp_start).getTime()
                : 0),
        });
        if (opts.runs === 1 && opts.output === "json") {
            console.log(JSON.stringify(result.bundle, null, 2));
        }
    }
    // Summary
    if (opts.output === "table") {
        console.log("\n" + "=".repeat(60));
        console.log(`  CRUCIBLE RESULTS — ${opts.task}`);
        console.log("=".repeat(60));
        console.log(`  Model:    ${model}`);
        console.log(`  Adapter:  ${adapter.name}`);
        console.log(`  Runs:     ${opts.runs}`);
        console.log("-".repeat(60));
        for (const r of results) {
            const status = r.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
            console.log(`  Run ${r.run}: ${status}  Score: ${(r.score * 100).toFixed(0)}%  Time: ${r.duration}`);
        }
        if (opts.runs > 1) {
            const passCount = results.filter(r => r.passed).length;
            const avgScore = results.reduce((s, r) => s + r.score, 0) / results.length;
            console.log("-".repeat(60));
            console.log(`  pass@1: ${results[0]?.passed ? "yes" : "no"}`);
            console.log(`  pass@${opts.runs}: ${passCount > 0 ? "yes" : "no"} (${passCount}/${opts.runs})`);
            console.log(`  avg score: ${(avgScore * 100).toFixed(0)}%`);
        }
        console.log("=".repeat(60));
        console.log(`  Bundles stored in: runs/`);
        console.log("");
    }
    await adapter.teardown();
    // Exit with appropriate code
    const lastResult = results[results.length - 1];
    process.exit(lastResult?.passed ? 0 : 1);
}
//# sourceMappingURL=test.js.map