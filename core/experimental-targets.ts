/**
 * Luak — Experimental benchmark targets
 *
 * A small, self-contained registry of *experimental* models that may be
 * benchmarked but must never be wired into default routing, the judge, the
 * leaderboard, or capability certification. This module is intentionally
 * **not imported** by `adapters/registry.ts`, `core/judge-config.ts`, or the
 * `harness` command — nothing here changes the behaviour of a normal run.
 * It is consumed only by:
 *
 *   - `scripts/minimax-m3-bench.mjs`  (the explicit, cost-capped runner)
 *   - `tests/experimental-targets.test.ts`
 *
 * The first experimental target is OpenRouter's MiniMax-M3, added so it can be
 * compared head-to-head against the MiMo v2.5 family and the current Luak
 * baselines without being promoted to anything. Every record below carries
 * `affects_leaderboard: false` and `affects_certification: false`, mirroring
 * the Vision/Roleplay experimental doctrine.
 *
 * All cost figures are USD-per-million-tokens, sourced from the live
 * OpenRouter `/models` pricing endpoint (captured 2026-05-31). They are used
 * only for *pre-flight estimates and receipts*; the OpenRouter adapter records
 * the provider's actual billed cost (`usage.cost`) on every call, which always
 * wins over these estimates when present.
 */

export type TargetTier = "EXPERIMENTAL";

export type CategoryExecution = "repo" | "conversational";

/** USD-per-million-token pricing for a single OpenRouter route. */
export interface ModelPricing {
  /** OpenRouter model slug, e.g. `minimax/minimax-m3`. */
  model: string;
  /** USD per 1,000,000 prompt (input) tokens. */
  input_per_m: number;
  /** USD per 1,000,000 completion (output) tokens. */
  output_per_m: number;
  /** Advertised context window, tokens. Informational. */
  context_length: number;
}

/** A user-facing benchmark category mapped onto concrete Luak task ids. */
export interface BenchmarkCategory {
  /** Stable key used on the CLI (`--categories`). */
  key: string;
  /** Human label surfaced in reports and the verdict. */
  label: string;
  /** Whether Luak actually has tasks covering this category today. */
  supported: boolean;
  /** Task ids exercised for this category (empty when unsupported). */
  taskIds: string[];
  /** How the listed tasks run — drives runner dispatch in the .mjs script. */
  execution: CategoryExecution;
  /** Why a category is unsupported, or what the supported tasks probe. */
  note: string;
}

export interface ExperimentalTarget {
  /** Short alias required on the CLI (`--model minimax-m3`). */
  alias: string;
  /** Display name. */
  label: string;
  /** Registry adapter id this target routes through. */
  adapter: string;
  /** Provider-native / OpenRouter model slug forwarded to the adapter. */
  model: string;
  tier: TargetTier;
  /** Hard guarantees — these targets never influence rankings. */
  affects_leaderboard: false;
  affects_certification: false;
  /**
   * Default output-token cap for cost-capped runs. The runner exports this as
   * `OPENROUTER_MAX_OUTPUT_TOKENS` so both chat() and execute() paths honour
   * it. Deliberately moderate, not the adapter's 8192 default.
   */
  default_max_output_tokens: number;
  /** Pricing for the candidate plus its comparison set. */
  pricing: ModelPricing[];
  /** Comparison routes (OpenRouter slugs) this target is judged against. */
  comparison_models: string[];
  /** One-line reason this target exists. */
  rationale: string;
}

// ── Pricing table (USD / 1M tokens; OpenRouter live, 2026-05-31) ─────────────

const PRICING: ModelPricing[] = [
  { model: "minimax/minimax-m3",    input_per_m: 0.30,  output_per_m: 1.20, context_length: 1_048_576 },
  { model: "xiaomi/mimo-v2.5",      input_per_m: 0.14,  output_per_m: 0.28, context_length: 1_048_576 },
  { model: "xiaomi/mimo-v2.5-pro",  input_per_m: 0.435, output_per_m: 0.87, context_length: 1_048_576 },
];

// ── The MiniMax-M3 experimental target ───────────────────────────────────────

export const MINIMAX_M3: ExperimentalTarget = {
  alias: "minimax-m3",
  label: "MiniMax-M3 (OpenRouter, experimental)",
  adapter: "openrouter",
  model: "minimax/minimax-m3",
  tier: "EXPERIMENTAL",
  affects_leaderboard: false,
  affects_certification: false,
  default_max_output_tokens: 1024,
  pricing: PRICING,
  comparison_models: ["xiaomi/mimo-v2.5", "xiaomi/mimo-v2.5-pro"],
  rationale:
    "Evaluate OpenRouter MiniMax-M3 against the MiMo v2.5 family and Luak " +
    "baselines before deciding whether it earns any routing role.",
};

/** All registered experimental targets, keyed by alias. */
export const EXPERIMENTAL_TARGETS: Record<string, ExperimentalTarget> = {
  [MINIMAX_M3.alias]: MINIMAX_M3,
};

/**
 * Resolve a CLI alias (or a raw OpenRouter slug) to an experimental target.
 * Returns null for anything not explicitly registered — callers must treat a
 * null as "not an experimental target" and refuse to run it through this path.
 */
export function resolveExperimentalTarget(aliasOrModel: string): ExperimentalTarget | null {
  const needle = aliasOrModel.trim().toLowerCase();
  if (!needle) return null;
  const byAlias = EXPERIMENTAL_TARGETS[needle];
  if (byAlias) return byAlias;
  for (const target of Object.values(EXPERIMENTAL_TARGETS)) {
    if (target.model.toLowerCase() === needle) return target;
  }
  return null;
}

// ── Category → task mapping ──────────────────────────────────────────────────
//
// Maps the seven requested benchmark categories onto concrete Luak task ids.
// `prompt-refinement-luna` has no harness coverage today and is marked
// unsupported rather than silently dropped — the runner logs the gap and the
// verdict reports it as "not evaluated".

export const BENCHMARK_CATEGORIES: BenchmarkCategory[] = [
  {
    key: "coding-patch-reasoning",
    label: "Coding patch reasoning",
    supported: true,
    taskIds: ["poison-001", "spec-001"],
    execution: "repo",
    note: "Locate and patch a real bug, then keep the public tests green.",
  },
  {
    key: "long-context-repo-comprehension",
    label: "Long-context repo comprehension",
    supported: true,
    taskIds: ["coord-001"],
    execution: "repo",
    note: "Multi-file orchestration task requiring whole-repo understanding.",
  },
  {
    key: "tool-call-planning",
    label: "Tool-call planning",
    supported: true,
    taskIds: ["tool-001", "tool-006"],
    execution: "repo",
    note: "Schema-valid tool calls and loop-avoidance under a tool protocol.",
  },
  {
    key: "migration-audit-reasoning",
    label: "Migration / audit reasoning",
    supported: true,
    taskIds: ["spec-002", "spec-003"],
    execution: "repo",
    note: "Spec-discipline tasks standing in for migration/audit reasoning.",
  },
  {
    key: "prompt-refinement-luna",
    label: "Prompt refinement for Luna asset generation",
    supported: false,
    taskIds: [],
    execution: "conversational",
    note: "No Luak task covers Luna asset-prompt refinement; not evaluated.",
  },
  {
    key: "structured-json-reliability",
    label: "Structured JSON reliability",
    supported: true,
    taskIds: ["tool-001", "tool-002"],
    execution: "repo",
    note: "Tool-calling tasks that require well-formed JSON arguments.",
  },
  {
    key: "refusal-overblocking",
    label: "Refusal / overblocking behaviour",
    supported: true,
    taskIds: ["safety-001", "safety-002", "safety-003"],
    execution: "conversational",
    note: "Safety lane — refusal quality and overblocking on boundary prompts.",
  },
];

/** The single cheapest task used for the mandatory pre-flight smoke. */
export const SMOKE_TASK_ID = "safety-001";

export function supportedCategories(): BenchmarkCategory[] {
  return BENCHMARK_CATEGORIES.filter((c) => c.supported);
}

export function unsupportedCategories(): BenchmarkCategory[] {
  return BENCHMARK_CATEGORIES.filter((c) => !c.supported);
}

/** Distinct task ids across all supported categories, smoke task first. */
export function plannedTaskIds(categories: BenchmarkCategory[] = supportedCategories()): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (id: string) => {
    if (!seen.has(id)) { seen.add(id); ordered.push(id); }
  };
  for (const cat of categories) {
    if (!cat.supported) continue;
    for (const id of cat.taskIds) push(id);
  }
  return ordered;
}

// ── Cost estimation ──────────────────────────────────────────────────────────

/**
 * Estimate USD cost for a model route from token counts, using the static
 * pricing table. Falls back to the MiniMax-M3 rate for unknown routes (the
 * most expensive of the set) so estimates never under-state spend. Callers
 * with a provider-reported actual cost should prefer that over this estimate.
 */
export function estimateUsdCost(model: string, tokensIn: number, tokensOut: number): number {
  const needle = model.trim().toLowerCase();
  const match =
    PRICING.find((p) => p.model.toLowerCase() === needle) ??
    PRICING.find((p) => p.model === MINIMAX_M3.model)!;
  return (tokensIn / 1_000_000) * match.input_per_m + (tokensOut / 1_000_000) * match.output_per_m;
}

export function pricingFor(model: string): ModelPricing | null {
  const needle = model.trim().toLowerCase();
  return PRICING.find((p) => p.model.toLowerCase() === needle) ?? null;
}

// ── Batch policy ─────────────────────────────────────────────────────────────
//
// "No batch runs unless explicitly approved." A run is a batch when it would
// execute more than one model OR repeat tasks more than once OR exceed a small
// per-invocation task ceiling. The smoke + a single-pass single-model probe is
// never a batch.

export const SINGLE_PASS_TASK_CEILING = 4;

export interface BatchPlan {
  modelCount: number;
  runs: number;
  taskCount: number;
}

export interface BatchDecision {
  isBatch: boolean;
  reasons: string[];
}

export function evaluateBatch(plan: BatchPlan): BatchDecision {
  const reasons: string[] = [];
  if (plan.modelCount > 1) reasons.push(`compares ${plan.modelCount} models`);
  if (plan.runs > 1) reasons.push(`repeats tasks ${plan.runs}x`);
  if (plan.taskCount > SINGLE_PASS_TASK_CEILING) {
    reasons.push(`runs ${plan.taskCount} tasks (> ${SINGLE_PASS_TASK_CEILING})`);
  }
  return { isBatch: reasons.length > 0, reasons };
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export type Recommendation =
  | "DEFAULT"
  | "FALLBACK"
  | "SPECIALIST"
  | "EXPERIMENTAL"
  | "REJECT"
  // The run never produced a model-quality signal. These are NOT verdicts about
  // the model — they mark the run itself as unusable, so they must never be
  // confused with REJECT (which means "measured and found wanting").
  | "PROVIDER_FAILURE"
  | "INVALID_RUN";

/** Aggregate metrics for one model route across a benchmark run. */
export interface RouteMetrics {
  model: string;
  tasksRun: number;
  tasksPassed: number;
  /** Pass rate in [0,1]; 0 when no tasks ran. */
  passRate: number;
  /** Average wall-clock latency per task, ms. */
  avgLatencyMs: number;
  /** Total USD cost (provider-actual when available, else estimated). */
  totalCostUsd: number;
  /** Cost per passing task; Infinity when nothing passed. */
  costPerUsefulUsd: number;
  /** How many tool-call + structured-JSON tasks were actually measured. */
  toolJsonTasksRun: number;
  /** Pass rate on tool-call + structured-JSON categories, [0,1]; 0 when none ran. */
  toolJsonReliability: number;
  /** Observed failure-mode codes/summaries (deduped). */
  failureModes: string[];
  /**
   * Tasks whose provider call completed enough to grade the *model* — i.e. the
   * provider returned a (possibly failing) model response. Provider/network/
   * harness failures do NOT count. When this is 0 the run carries no
   * model-quality signal.
   */
  completedCalls: number;
  /** Tasks that failed at the provider or network layer (no model response). */
  providerFailures: number;
  /** Total tokens (in + out) actually observed across the run. */
  tokensObserved: number;
  /** Total USD actually spent/estimated across the run. */
  spendObserved: number;
}

/**
 * Decide whether a route's metrics constitute a usable model-quality signal.
 * A run is invalid when no provider call completed, or when every task failed
 * at the provider, or when nothing was actually spent or tokenised. These are
 * run-health problems, never model-quality verdicts.
 */
export function assessRunValidity(m: RouteMetrics): {
  valid: boolean;
  recommendation: "PROVIDER_FAILURE" | "INVALID_RUN" | null;
  reason: string;
} {
  if (m.tasksRun === 0) {
    return { valid: false, recommendation: "INVALID_RUN", reason: "No tasks ran." };
  }
  const providerDominated = m.providerFailures >= m.tasksRun;
  if (m.completedCalls === 0 && (m.providerFailures > 0 || providerDominated)) {
    return {
      valid: false,
      recommendation: "PROVIDER_FAILURE",
      reason:
        `Provider calls did not complete (${m.providerFailures}/${m.tasksRun} tasks failed at the ` +
        `provider; ${m.tokensObserved} tokens, ${fmtUsd(m.spendObserved)} spend). ` +
        `Re-run after the provider route is healthy.`,
    };
  }
  if (m.completedCalls === 0 || (m.tokensObserved === 0 && m.spendObserved === 0)) {
    return {
      valid: false,
      recommendation: "INVALID_RUN",
      reason:
        `Zero tokens and zero spend across ${m.tasksRun} task(s) — no measurable model output.`,
    };
  }
  return { valid: true, recommendation: null, reason: "" };
}

export interface VerdictInput {
  candidate: RouteMetrics;
  /** xiaomi/mimo-v2.5 metrics, if that route was run. */
  mimo?: RouteMetrics | undefined;
  /** xiaomi/mimo-v2.5-pro metrics, if that route was run. */
  mimoPro?: RouteMetrics | undefined;
  /** True when at least the candidate produced gradable results. */
  hasData: boolean;
}

export interface Verdict {
  recommendation: Recommendation;
  rationale: string;
  qualityVsMimo: string;
  qualityVsMimoPro: string;
  latency: string;
  toolJsonReliability: string;
  failureModes: string[];
  costPerUsefulResult: string;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "n/a (no passing tasks)";
  if (n === 0) return "$0.0000";
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function describeDelta(label: string, candidate: number, other?: RouteMetrics): string {
  if (!other || other.tasksRun === 0) return `${label}: not run in this comparison`;
  const delta = candidate - other.passRate;
  const dir = delta > 0.02 ? "higher" : delta < -0.02 ? "lower" : "comparable";
  return `${label}: ${fmtPct(candidate)} vs ${fmtPct(other.passRate)} (${dir}, Δ ${(delta * 100).toFixed(0)}pts)`;
}

/**
 * Map aggregate metrics to one of DEFAULT / FALLBACK / SPECIALIST /
 * EXPERIMENTAL / REJECT. Thresholds are intentionally conservative — an
 * experimental target stays EXPERIMENTAL unless the evidence clearly supports
 * a stronger or weaker call.
 */
export function classifyRecommendation(input: VerdictInput): { recommendation: Recommendation; rationale: string } {
  const { candidate, mimo, mimoPro, hasData } = input;

  if (!hasData || candidate.tasksRun === 0) {
    return { recommendation: "EXPERIMENTAL", rationale: "Insufficient data — no gradable candidate results." };
  }

  // Run-health gate — comes BEFORE the reliability floor. A run with no
  // completed provider calls (provider_error-only, or 0 tokens / 0 spend) is
  // not a model-quality verdict: it must surface as PROVIDER_FAILURE /
  // INVALID_RUN, never as REJECT, and must not be compared against the MiMo
  // family (that comparison would be meaningless).
  const validity = assessRunValidity(candidate);
  if (!validity.valid && validity.recommendation) {
    return { recommendation: validity.recommendation, rationale: validity.reason };
  }

  // Tool/JSON reliability only counts as evidence when those tasks actually
  // ran — a smoke or category-filtered run must not be REJECTed for a 0% that
  // simply means "not measured".
  const toolJsonMeasured = candidate.toolJsonTasksRun > 0;
  const strongToolJson = toolJsonMeasured && candidate.toolJsonReliability >= 0.8;

  // Hard floor — unreliable on basics → reject regardless of cost.
  if (candidate.passRate < 0.4 || (toolJsonMeasured && candidate.toolJsonReliability < 0.4)) {
    const detail = toolJsonMeasured ? `, tool/JSON ${fmtPct(candidate.toolJsonReliability)}` : "";
    return {
      recommendation: "REJECT",
      rationale: `Below reliability floor (pass ${fmtPct(candidate.passRate)}${detail}).`,
    };
  }

  const beatsPro = mimoPro && mimoPro.tasksRun > 0 && candidate.passRate >= mimoPro.passRate - 0.02;
  const cheaperThanPro = mimoPro && Number.isFinite(candidate.costPerUsefulUsd) &&
    candidate.costPerUsefulUsd <= mimoPro.costPerUsefulUsd;
  const beatsMimo = mimo && mimo.tasksRun > 0 && candidate.passRate >= mimo.passRate - 0.02;

  if (beatsPro && cheaperThanPro && strongToolJson) {
    return {
      recommendation: "DEFAULT",
      rationale: "Matches/exceeds MiMo v2.5 Pro quality at no worse cost-per-useful, with strong tool/JSON reliability.",
    };
  }

  // Excels narrowly (tool/JSON or long-context proxy) but not broadly.
  if (strongToolJson && candidate.passRate < 0.7) {
    return {
      recommendation: "SPECIALIST",
      rationale: "Strong on structured/tool tasks but uneven elsewhere — route only the categories it wins.",
    };
  }

  if (beatsMimo || beatsPro) {
    return {
      recommendation: "FALLBACK",
      rationale: "Competitive with the MiMo family but not a clear, cheaper win — usable as a secondary route.",
    };
  }

  return {
    recommendation: "EXPERIMENTAL",
    rationale: "Mixed results versus the MiMo family — keep gated and gather more evidence before any routing role.",
  };
}

export function buildVerdict(input: VerdictInput): Verdict {
  const { candidate, mimo, mimoPro } = input;
  const { recommendation, rationale } = classifyRecommendation(input);

  // When the run produced no model-quality signal we must NOT compare the
  // candidate against the MiMo family — a delta against an equally-broken (or
  // un-run) baseline is noise that reads like a real quality judgement.
  const incomparable =
    recommendation === "PROVIDER_FAILURE" || recommendation === "INVALID_RUN";
  const noCompare = "not compared — provider calls did not complete";

  return {
    recommendation,
    rationale,
    qualityVsMimo: incomparable ? noCompare : describeDelta("MiMo v2.5", candidate.passRate, mimo),
    qualityVsMimoPro: incomparable ? noCompare : describeDelta("MiMo v2.5 Pro", candidate.passRate, mimoPro),
    latency: incomparable
      ? "not measured (provider calls did not complete)"
      : candidate.tasksRun ? `${Math.round(candidate.avgLatencyMs)} ms/task avg` : "no runs",
    toolJsonReliability: incomparable
      ? "not measured (provider calls did not complete)"
      : candidate.toolJsonTasksRun > 0
        ? `${fmtPct(candidate.toolJsonReliability)} pass on tool-call + JSON categories (${candidate.toolJsonTasksRun} tasks)`
        : "not measured (no tool-call / JSON tasks in this run)",
    failureModes: candidate.failureModes.length ? candidate.failureModes : ["none observed"],
    costPerUsefulResult: incomparable ? "n/a (run invalid)" : fmtUsd(candidate.costPerUsefulUsd),
  };
}
