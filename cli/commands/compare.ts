/**
 * Luak CLI — compare command
 * Run the same task(s) against multiple models and compare results.
 * Supports pass@k scoring across repeated runs.
 */

import { runTask } from "../../core/runner.js";
import { storeBundle } from "../../core/bundle.js";
import { OllamaAdapter } from "../../adapters/ollama.js";
import { OpenRouterAdapter } from "../../adapters/openrouter.js";
import { OpenClawAdapter } from "../../adapters/openclaw.js";
import { ClaudeCodeAdapter } from "../../adapters/claudecode.js";
import type { CrucibulumAdapter, EvidenceBundle } from "../../adapters/base.js";
import { log } from "../../utils/logger.js";
import { formatDuration } from "../../utils/timing.js";
import { formatCost } from "../../utils/cost.js";

const COMPARE_USAGE = `Luak compare — run one task against multiple models and compare results.

Usage:
  luak compare --models <specA>,<specB>[,...] --task <taskId> [options]

Model spec syntax — "adapter:model":
  Each entry in --models is "<adapter>:<model>". The text before the FIRST
  colon selects the adapter; everything after it is the model id (model ids
  may themselves contain colons, e.g. ollama tags like "gemma3:27b").
    adapter      provider / route
    ----------   ----------------------------------------------------------
    ollama       local Ollama daemon (OLLAMA_URL, default localhost:11434)
    openrouter   OpenRouter cloud (needs OPENROUTER_API_KEY)
    openclaw     OpenClaw gateway
    claudecode   Claude Code CLI   (alias: claude)
  A bare value with no colon defaults to the ollama adapter.

  Worked example:
    luak compare \\
      --models openrouter:openai/gpt-4o-mini,ollama:gemma3:27b \\
      --task poison-001 --runs 3 --max-cost-usd 0.50
  This races GPT-4o-mini (via OpenRouter) against a local gemma3:27b on
  poison-001, three runs each, aborting before any provider call once
  accumulated spend reaches $0.50.

Options:
  --models <list>     Comma-separated "adapter:model" specs (>=2 required)
  --task <taskId>     Task to run against every model (required)
  --runs <N>          Runs per model for pass@k (default: 1)
  --output <fmt>      table (default) | json
  --max-cost-usd <N>  Abort before further provider calls once estimated
                      spend reaches this budget. Also LUAK_MAX_COST_USD.`;

function resolveMaxCost(explicit: number | null): number {
  if (explicit !== null) return explicit;
  const raw = (process.env["LUAK_MAX_COST_USD"] ?? process.env["CRUCIBLE_MAX_COST_USD"] ?? "").trim();
  if (!raw) return Infinity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Infinity;
}

function parseArgs(args: string[]): { models: string[]; task: string; runs: number; output: "table" | "json"; maxCostUsd: number } {
  let modelsStr = "";
  let task = "";
  let runs = 1;
  let output: "table" | "json" = "table";
  let maxCostExplicit: number | null = null;

  if (args.includes("--help") || args.includes("-h")) { console.log(COMPARE_USAGE); process.exit(0); }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--models" && next) { modelsStr = next; i++; }
    else if (arg === "--task" && next) { task = next; i++; }
    else if (arg === "--runs" && next) { runs = parseInt(next, 10) || 1; i++; }
    else if (arg === "--output" && next) { output = next === "json" ? "json" : "table"; i++; }
    else if (arg === "--max-cost-usd" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) { console.error("Error: --max-cost-usd must be a positive number"); process.exit(5); }
      maxCostExplicit = parsed; i++;
    }
  }

  if (!modelsStr) { console.error("Error: --models required (comma-separated, e.g. ollama:gemma3:27b,openrouter:openai/gpt-4o-mini)\n\n" + COMPARE_USAGE); process.exit(5); }
  if (!task) { console.error("Error: --task required"); process.exit(5); }

  const models = modelsStr.split(",").map(m => m.trim()).filter(Boolean);
  if (models.length < 2) { console.error("Error: need at least 2 models to compare"); process.exit(5); }

  return { models, task, runs, output, maxCostUsd: resolveMaxCost(maxCostExplicit) };
}

function resolveAdapter(modelSpec: string): { adapter: CrucibulumAdapter; model: string } {
  const colonIdx = modelSpec.indexOf(":");
  if (colonIdx === -1) return { adapter: new OllamaAdapter(), model: modelSpec };
  const adapterName = modelSpec.slice(0, colonIdx);
  const model = modelSpec.slice(colonIdx + 1);
  switch (adapterName) {
    case "ollama": return { adapter: new OllamaAdapter(), model };
    case "openrouter": return { adapter: new OpenRouterAdapter(), model };
    case "openclaw": return { adapter: new OpenClawAdapter(), model };
    case "claudecode":
    case "claude": return { adapter: new ClaudeCodeAdapter(), model };
    default: console.error(`Unknown adapter: ${adapterName}. Available: ollama, openrouter, openclaw, claudecode`); process.exit(5);
  }
}

interface ModelResult {
  modelSpec: string;
  runs: Array<{ score: number; pass: boolean; bundle: EvidenceBundle; duration: number }>;
  avgScore: number;
  passRate: number;
  passAt1: boolean;
  passAtK: boolean;
  avgDuration: number;
  failureModes: Record<string, number>;
}

export async function compareCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  console.log(`\nLuak Compare: ${opts.task}`);
  console.log(`Models: ${opts.models.join(" vs ")}`);
  console.log(`Runs per model: ${opts.runs}`);
  if (Number.isFinite(opts.maxCostUsd)) console.log(`Cost budget: ${formatCost(opts.maxCostUsd)} (guard active)`);
  console.log("");

  const results: ModelResult[] = [];

  // Live-run cost budget guard. We can't know a call's cost before it returns,
  // so the guard caps *accumulated* estimated spend: once spent >= budget we
  // refuse to start any further provider call. Local adapters (ollama) report
  // $0 cost, so an all-local compare never trips the guard.
  let spentUsd = 0;
  let budgetTripped = false;
  const bundleCost = (b: EvidenceBundle): number =>
    (b.usage?.estimated_cost_usd ?? 0) + (b.judge_usage?.estimated_cost_usd ?? 0);

  for (const modelSpec of opts.models) {
    if (budgetTripped) break;
    const { adapter, model } = resolveAdapter(modelSpec);
    await adapter.init({ model } as Record<string, unknown>);

    const health = await adapter.healthCheck();
    if (!health.ok) {
      console.error(`  ${modelSpec}: health check failed — ${health.reason}`);
      await adapter.teardown();
      continue;
    }

    console.log(`  Running ${modelSpec}...`);
    const modelRuns: ModelResult["runs"] = [];

    for (let run = 1; run <= opts.runs; run++) {
      // Guard fires BEFORE the provider call so we never spend past the budget.
      if (spentUsd >= opts.maxCostUsd) {
        budgetTripped = true;
        console.log(`    Cost budget reached (${formatCost(spentUsd)} >= ${formatCost(opts.maxCostUsd)}). Stopping before next provider call.`);
        break;
      }
      if (opts.runs > 1) process.stdout.write(`    Run ${run}/${opts.runs}... `);
      try {
        const result = await runTask({ taskId: opts.task, adapter, model });
        storeBundle(result.bundle);
        spentUsd += bundleCost(result.bundle);

        const startTime = new Date(result.bundle.environment.timestamp_start).getTime();
        const endTime = new Date(result.bundle.environment.timestamp_end).getTime();
        const duration = Math.round((endTime - startTime) / 1000);

        modelRuns.push({ score: result.score, pass: result.passed, bundle: result.bundle, duration });
        if (opts.runs > 1) console.log(`${result.passed ? "PASS" : "FAIL"} ${(result.score * 100).toFixed(0)}% ${duration}s`);
      } catch (err) {
        if (opts.runs > 1) console.log(`ERROR: ${String(err).slice(0, 80)}`);
      }
    }

    await adapter.teardown();

    if (modelRuns.length === 0) continue;

    const avgScore = modelRuns.reduce((s, r) => s + r.score, 0) / modelRuns.length;
    const passCount = modelRuns.filter(r => r.pass).length;
    const failureModes: Record<string, number> = {};
    for (const r of modelRuns) {
      const mode = r.bundle.diagnosis.failure_mode;
      if (mode) failureModes[mode] = (failureModes[mode] ?? 0) + 1;
    }

    results.push({
      modelSpec,
      runs: modelRuns,
      avgScore,
      passRate: passCount / modelRuns.length,
      passAt1: modelRuns[0]?.pass ?? false,
      passAtK: passCount > 0,
      avgDuration: Math.round(modelRuns.reduce((s, r) => s + r.duration, 0) / modelRuns.length),
      failureModes,
    });
  }

  // Output
  if (opts.output === "json") {
    console.log(JSON.stringify({
      task: opts.task,
      total_estimated_cost_usd: Math.round(spentUsd * 1_000_000) / 1_000_000,
      cost_budget_usd: Number.isFinite(opts.maxCostUsd) ? opts.maxCostUsd : null,
      cost_budget_tripped: budgetTripped,
      models: results.map(r => ({
      model: r.modelSpec,
      avg_score: r.avgScore,
      pass_rate: r.passRate,
      pass_at_1: r.passAt1,
      pass_at_k: r.passAtK,
      avg_duration_sec: r.avgDuration,
      failure_modes: r.failureModes,
      runs: r.runs.map(run => ({ score: run.score, pass: run.pass, duration: run.duration })),
    })),
    }, null, 2));
  } else {
    // Table output
    console.log("\n" + "═".repeat(70));
    console.log("  COMPARISON — " + opts.task);
    console.log("═".repeat(70));

    for (const r of results) {
      const passColor = r.passRate >= 0.7 ? "\x1b[32m" : r.passRate >= 0.5 ? "\x1b[33m" : "\x1b[31m";
      console.log(`\n  ${r.modelSpec}`);
      console.log(`  ${"─".repeat(50)}`);
      console.log(`  Avg Score:  ${passColor}${(r.avgScore * 100).toFixed(0)}%\x1b[0m`);
      console.log(`  Pass Rate:  ${passColor}${(r.passRate * 100).toFixed(0)}%\x1b[0m (${r.runs.filter(x => x.pass).length}/${r.runs.length})`);
      console.log(`  pass@1:     ${r.passAt1 ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
      console.log(`  pass@${opts.runs}:     ${r.passAtK ? "\x1b[32myes\x1b[0m" : "\x1b[31mno\x1b[0m"}`);
      console.log(`  Avg Time:   ${r.avgDuration}s`);
      if (Object.keys(r.failureModes).length > 0) {
        console.log(`  Failures:   ${Object.entries(r.failureModes).map(([k, v]) => `${k}(${v})`).join(", ")}`);
      }
    }

    // Winner
    if (results.length >= 2) {
      const sorted = [...results].sort((a, b) => b.avgScore - a.avgScore);
      console.log(`\n${"═".repeat(70)}`);
      console.log(`  Winner: ${sorted[0]!.modelSpec} (${(sorted[0]!.avgScore * 100).toFixed(0)}%)`);
      console.log(`${"═".repeat(70)}\n`);
    }
    console.log(`  Estimated spend: ${formatCost(spentUsd)}${Number.isFinite(opts.maxCostUsd) ? ` / budget ${formatCost(opts.maxCostUsd)}` : ""}${budgetTripped ? " — budget reached, comparison stopped early" : ""}\n`);
  }
}
