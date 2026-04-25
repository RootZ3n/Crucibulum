/**
 * Crucible CLI — `harness` command
 *
 * Comprehensive QA / regression harness for Ricky, Ptah, and any other
 * verifying agent. Walks every tab/lane, every test in each lane, runs each
 * one in a controlled mode, and validates the pipeline end-to-end:
 *
 *   1. test can start                       — manifest loads cleanly
 *   2. model request is sent                — adapter.chat()/execute() runs
 *   3. response is received                 — non-empty model output recorded
 *   4. judge/scorer runs                    — deterministic + (optional) model
 *   5. result is recorded                   — bundle stored on disk
 *   6. UI can display the result            — summary contract is well-formed
 *   7. drilldown evidence is present        — prompt, answer, expected,
 *                                              judgement, reason, cost/tokens
 *
 * The harness emits a machine-readable JSON report (default destination
 * `runs/_harness_report_<timestamp>.json`) that downstream agents consume.
 *
 * Usage
 * -----
 *   npm run harness                      # offline, harness-mock adapter
 *   npm run harness -- --tab personality # only run the Personality lane
 *   npm run harness -- --task spec-001   # run a single test by id
 *   npm run harness -- --live            # use the configured judge model
 *                                        #   (OpenRouter MiMo by default)
 *                                        #   for all chat() calls and the
 *                                        #   review layer; needs an API key
 *
 *   node dist/cli/main.js harness ...
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTasks } from "../../core/manifest.js";
import { storeBundle } from "../../core/bundle.js";
import { runTask } from "../../core/runner.js";
import { isConversationalTask, runConversationalTask, loadConversationalManifest } from "../../core/conversational-runner.js";
import { HarnessMockAdapter } from "../../adapters/harness-mock.js";
import { instantiateAdapterForRun, resolveAdapter, listRegisteredAdapters } from "../../adapters/registry.js";
import { describeDefaultJudge } from "../../core/judge-config.js";
import { buildReviewConfigFromJudge } from "../../core/review.js";
import { resolveDisplayName } from "../../core/test-names.js";
import { log } from "../../utils/logger.js";
import { formatCost } from "../../utils/cost.js";
import type { CrucibulumAdapter, EvidenceBundle } from "../../adapters/base.js";
import { canonicalPercent } from "../../types/scores.js";
import { normalizeBundleVerdict } from "../../core/verdict.js";
import { summarizeBundle } from "../../server/contracts.js";

// ── Tab / lane registry ─────────────────────────────────────────────────────

interface LaneSpec {
  key: string;
  label: string;
  taskFamilies: string[];
  /** Hint about what the lane covers — surfaced in the report. */
  headline: string;
}

/** Mirror of TAB_CONFIG in ui/index.html. Single source of truth in the harness. */
export const HARNESS_LANES: LaneSpec[] = [
  { key: "personality", label: "Personality", taskFamilies: ["personality", "identity"], headline: "Identity, behaviour, style, and pressure tests." },
  { key: "benchmark",   label: "Benchmark",   taskFamilies: ["spec_discipline", "truthfulness", "cost_efficiency"], headline: "Truth, discipline, efficiency, and general quality." },
  { key: "poison",      label: "Poison",      taskFamilies: ["poison_localization"], headline: "Bug planting and bug-finding." },
  { key: "build",       label: "Build",       taskFamilies: ["orchestration"],       headline: "Multi-step repo work and workflow execution." },
  { key: "safety",      label: "Safety",      taskFamilies: ["safety"],              headline: "Boundary, refusal quality, and child-safety scenarios." },
  { key: "memory",      label: "Memory",      taskFamilies: ["memory"],              headline: "Cross-turn recall and honest memory handling." },
];

// ── Argv parsing ────────────────────────────────────────────────────────────

export interface HarnessArgs {
  tabs: string[] | null;
  taskIds: string[] | null;
  /**
   * Deprecated alias for `adapter: openrouter` + the configured judge
   * model. Kept for backwards compatibility — `--adapter <id> --model <id>`
   * is the preferred form.
   */
  live: boolean;
  /** Adapter id from the registry (`openrouter`, `minimax`, `ollama`, …). */
  adapter: string | null;
  /** Provider id override (only used by configurable adapters like Squidley). */
  provider: string | null;
  /** Model id passed to the adapter. Free-form; the adapter decides if it's valid. */
  model: string | null;
  outputPath: string | null;
  verbose: boolean;
  enableJudge: boolean;
  retries?: number;
  timeoutMs?: number | null;
}

export function parseArgs(args: string[]): HarnessArgs {
  const out: HarnessArgs = {
    tabs: null,
    taskIds: null,
    live: false,
    adapter: null,
    provider: null,
    model: null,
    outputPath: null,
    verbose: false,
    enableJudge: false,
    retries: 1,
    timeoutMs: null,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if ((arg === "--tab" || arg === "--lane") && next) {
      out.tabs = (out.tabs ?? []).concat(next.split(","));
      i++;
    } else if (arg === "--task" && next) {
      out.taskIds = (out.taskIds ?? []).concat(next.split(","));
      i++;
    } else if (arg === "--live") {
      out.live = true;
    } else if (arg === "--enable-judge") {
      // Run the optional model judge layer (counts toward judge_usage cost).
      out.enableJudge = true;
    } else if (arg === "--adapter" && next) {
      out.adapter = next;
      i++;
    } else if (arg === "--provider" && next) {
      out.provider = next;
      i++;
    } else if (arg === "--model" && next) {
      out.model = next;
      i++;
    } else if (arg === "--retries" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error("harness: --retries must be a non-negative integer");
      out.retries = parsed;
      i++;
    } else if (arg === "--timeout-ms" && next) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("harness: --timeout-ms must be a positive integer");
      out.timeoutMs = parsed;
      i++;
    } else if (arg === "--output" && next) {
      out.outputPath = next;
      i++;
    } else if (arg === "--verbose" || arg === "-v") {
      out.verbose = true;
    }
  }
  return out;
}

// ── Adapter selection ───────────────────────────────────────────────────────

/**
 * Per-adapter env-var requirements. The harness checks these *before* it
 * instantiates anything, so a missing key produces a precise error message
 * naming the env var instead of a downstream "Authentication failed".
 * Adapter ids that aren't in this table either need no key (local) or
 * surface their own check via `healthCheck()`.
 */
const REQUIRED_ENV_BY_ADAPTER: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zai: "ZAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
};

export interface ResolvedHarnessAdapter {
  adapter: CrucibulumAdapter;
  /** Adapter id used for routing (matches registry id). */
  adapterId: string;
  /** Provider id reported in evidence (registry's fixed_provider, or override). */
  provider: string;
  /** Model id forwarded to the adapter. */
  model: string;
  /** "mock" only when the harness mock was selected; "live" otherwise. */
  mode: "mock" | "live";
}

/**
 * Decide selection mode without doing any I/O.
 *
 * Selection rules, applied in order:
 *
 *   1. `--adapter <id>` is explicit → live mode with that adapter. Fails
 *      if the id is unknown, if `--model` is missing on a registry that
 *      requires it, or if a known env var is unset for cloud adapters.
 *      Never falls back to mock.
 *
 *   2. `--live` (no `--adapter`) is the legacy form → live mode using
 *      OpenRouter + the configured judge model (CRUCIBLE_JUDGE_MODEL or
 *      the static default). Fails if OPENROUTER_API_KEY is missing.
 *
 *   3. No flag → mock mode. The harness mock adapter runs a deterministic
 *      offline replay. This is the only path that returns the mock.
 *
 * Splitting this from `buildAdapter` lets tests assert the routing
 * decision without touching the network or hitting the registry.
 */
export type AdapterPlan =
  | { kind: "mock"; reason: string }
  | { kind: "live"; adapterId: string; model: string; provider: string | null; sourceFlag: "adapter" | "live" };

export function planAdapter(args: HarnessArgs): AdapterPlan {
  if (args.adapter) {
    // Explicit adapter — never silently fall back to mock.
    const reg = resolveAdapter(args.adapter); // throws on unknown id
    if (reg.supports_custom_model && !args.model) {
      throw new Error(
        `harness: --adapter ${args.adapter} requires --model <id>. ` +
        `Available registered adapters: ${listRegisteredAdapters().map((r) => r.id).join(", ")}.`,
      );
    }
    return {
      kind: "live",
      adapterId: reg.id,
      model: args.model ?? "",
      provider: args.provider ?? reg.fixed_provider,
      sourceFlag: "adapter",
    };
  }
  if (args.live) {
    // Legacy `--live` form: OpenRouter + judge default.
    const judgeModel =
      args.model
      ?? process.env["CRUCIBLE_JUDGE_MODEL"]?.trim()
      ?? process.env["OPENROUTER_JUDGE_MODEL"]?.trim()
      ?? "xiaomi/mimo-v2-pro";
    return {
      kind: "live",
      adapterId: "openrouter",
      model: judgeModel,
      provider: "openrouter",
      sourceFlag: "live",
    };
  }
  return { kind: "mock", reason: "no --adapter or --live flag" };
}

export async function buildAdapter(args: HarnessArgs): Promise<ResolvedHarnessAdapter> {
  const plan = planAdapter(args);
  if (plan.kind === "mock") {
    const adapter = new HarnessMockAdapter();
    return { adapter, adapterId: "harness-mock", provider: "harness-mock", model: "harness-mock", mode: "mock" };
  }

  // Live mode — fail loud when the env var the operator obviously needs
  // is missing, before we instantiate anything that could swallow the
  // failure as a generic "auth error" later.
  const envKey = REQUIRED_ENV_BY_ADAPTER[plan.adapterId];
  if (envKey && !process.env[envKey]) {
    throw new Error(
      `harness: --adapter ${plan.adapterId} needs ${envKey} in the environment. ` +
      `Set it (export ${envKey}=...) or run with no flags for the offline mock.`,
    );
  }

  const runConfig: {
    adapter: string;
    model: string;
    provider: string | null;
    retries: number;
    timeout_ms?: number | null;
  } = {
    adapter: plan.adapterId,
    model: plan.model,
    provider: plan.provider,
    retries: args.retries ?? 1,
  };
  if (args.timeoutMs != null) runConfig.timeout_ms = args.timeoutMs;
  const { adapter, registry } = await instantiateAdapterForRun(runConfig);
  return {
    adapter,
    adapterId: registry.id,
    provider: plan.provider ?? registry.fixed_provider ?? registry.id,
    model: plan.model,
    mode: "live",
  };
}

// ── Result records ──────────────────────────────────────────────────────────

interface HarnessTestResult {
  tab: string;
  tab_label: string;
  task_id: string;
  display_name: string;
  family: string;
  execution_mode: "conversational" | "repo";
  // Pipeline phase outcomes — true means the phase succeeded.
  manifest_loaded: boolean;
  request_sent: boolean;
  response_received: boolean;
  judge_ran: boolean;
  bundle_stored: boolean;
  ui_summary_well_formed: boolean;
  drilldown_evidence_present: boolean;
  // Final outcome and supporting numbers.
  pass: boolean;
  pass_threshold_percent: number;
  score_percent: number;
  bundle_id: string | null;
  bundle_hash: string | null;
  // Cost/token transparency.
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  model_cost_usd: number;
  judge_provider: string;
  judge_model: string;
  judge_prompt_tokens: number;
  judge_completion_tokens: number;
  judge_cost_usd: number;
  total_cost_usd: number;
  // Anomaly + diagnosis.
  completion_state: string | null;
  failure_origin: string | null;
  failure_reason_code: string | null;
  interpretation: EvidenceBundle["interpretation"] | null;
  anomaly_flags: string[];
  suspicious_flags: string[];
  error_details: string | null;
  // Where to inspect the run in the UI: route hint plus bundle file.
  ui_route_hint: string | null;
  duration_ms: number;
}

interface HarnessReport {
  generated_at: string;
  mode: "mock" | "live";
  /** Adapter id actually used for this run (`openrouter`, `minimax`, `harness-mock`, …). */
  adapter: string;
  /** Provider id (registry's fixed_provider, or override for configurable adapters). */
  provider: string;
  /** Model id forwarded to the adapter. */
  model: string;
  judge_config: ReturnType<typeof describeDefaultJudge>;
  totals: {
    tabs_run: number;
    tests_run: number;
    tests_passed: number;
    tests_failed: number;
    failed_model: number;
    failed_provider: number;
    failed_runner: number;
    failed_judge: number;
    skipped_config: number;
    tests_with_anomalies: number;
    pipeline_breaks: number;
    model_cost_usd: number;
    judge_cost_usd: number;
    total_cost_usd: number;
    duration_ms: number;
  };
  failing_tests: HarnessTestResult[];
  results: HarnessTestResult[];
}

// ── Pipeline validation ─────────────────────────────────────────────────────

/**
 * Inspect a freshly-built bundle and decide whether each pipeline phase
 * succeeded. The harness uses these flags both for pass/fail reporting and
 * for surfacing suspicious patterns ("test marked pass without evidence",
 * "no token usage", "judge returned malformed JSON", etc.).
 */
function inspectBundle(bundle: EvidenceBundle, executionMode: "conversational" | "repo"): {
  responseReceived: boolean;
  judgeRan: boolean;
  drilldownEvidence: boolean;
  suspicious: string[];
} {
  const suspicious: string[] = [];

  // Repo runs don't carry per-question responses; "response_received" maps
  // to a non-error timeline that produced at least one shell or file event.
  // Conversational bundles populate verification_results.correctness.details
  // with one entry per scored question regardless of pass/fail — that's the
  // canonical "model returned something the judge could grade" signal.
  let responseReceived = false;
  if (executionMode === "conversational") {
    const haveDetails = Object.keys(bundle.verification_results.correctness?.details ?? {}).length > 0;
    const haveQuestionEvents = bundle.timeline.some((event) => (event.type === "task_complete" || event.type === "error") && typeof event.detail === "string" && /:\s*(PASS|FAIL)/.test(event.detail));
    responseReceived = haveDetails || haveQuestionEvents;
  } else {
    responseReceived = bundle.timeline.length > 0 && !bundle.timeline.every((event) => event.type === "error");
  }

  // Judge ran iff the verification block has correctness/regression/integrity
  // entries (deterministic) OR a model judge produced usage.
  const v = bundle.verification_results;
  const judgeRan = !!v && (
    Object.keys(v.correctness?.details ?? {}).length > 0
    || Object.keys(v.regression?.details ?? {}).length > 0
    || Object.keys(v.integrity?.details ?? {}).length > 0
  );

  // Drilldown evidence = the bundle exposes enough fields for the UI to
  // render the prompt/answer/expected/reason rows. For conversational
  // bundles the timeline carries the per-question reasons.
  const drilldownEvidence =
    bundle.timeline.length > 0
    && (executionMode !== "conversational" || bundle.timeline.some((event) => typeof event.detail === "string" && event.detail.length > 0));

  // Anomaly heuristics.
  if (bundle.score.pass && bundle.usage.tokens_in === 0 && bundle.usage.tokens_out === 0 && bundle.agent.provider !== "local") {
    suspicious.push("PASS_WITH_ZERO_TOKENS: cloud provider but no token usage reported");
  }
  if (bundle.agent.provider !== "local" && bundle.usage.estimated_cost_usd === 0 && bundle.usage.tokens_in + bundle.usage.tokens_out > 0) {
    suspicious.push("MISSING_COST: tokens reported but cost is zero on a cloud provider");
  }
  // Empty-answer-but-pass: scan timeline for any "FAIL" or "PASS" lines that
  // also carry an empty answer. Conversational runner stamps "PASS" or "FAIL"
  // in event.detail per-question.
  if (executionMode === "conversational" && bundle.score.pass) {
    for (const event of bundle.timeline) {
      if (event.type === "task_complete" && typeof event.detail === "string" && /:\s*PASS/.test(event.detail)) {
        // Look for matching transcript text in nearby timeline events; if
        // none was recorded, mark as silent-pass risk.
      }
    }
  }
  // Review JSON malformed.
  if (bundle.review?.secondOpinion?.status === "invalid_output" || bundle.review?.qcReview?.status === "invalid_output") {
    suspicious.push("JUDGE_MALFORMED_JSON: review model returned invalid JSON");
  }
  if (bundle.review?.secondOpinion?.status === "blocked_injection" || bundle.review?.qcReview?.status === "blocked_injection") {
    suspicious.push("REVIEW_BLOCKED_INJECTION: review input had injection markers");
  }
  return { responseReceived, judgeRan, drilldownEvidence, suspicious };
}

// ── Per-test runner ─────────────────────────────────────────────────────────

async function runOneTest(opts: {
  taskId: string;
  family: string;
  tabKey: string;
  tabLabel: string;
  adapter: CrucibulumAdapter;
  model: string;
  /** Provider id reported in the per-test row — not always identical to `adapter.id`. */
  provider: string;
  enableJudge: boolean;
  args: HarnessArgs;
}): Promise<HarnessTestResult> {
  const { taskId, family, tabKey, tabLabel, adapter, model, provider, enableJudge } = opts;
  const start = Date.now();
  const isConversational = isConversationalTask(taskId);
  const reviewConfig = enableJudge
    ? buildReviewConfigFromJudge({ secondOpinion: true })
    : undefined;

  // Resolve display name without touching the manifest a second time.
  let displayName = taskId;
  try {
    if (isConversational) {
      const m = loadConversationalManifest(taskId);
      displayName = resolveDisplayName(m as unknown as { id: string; description?: string }, taskId);
    } else {
      // For repo tasks the manifest title is reasonable enough.
      // We avoid a second load by deferring to resolveDisplayName via the
      // task list endpoint — but that call is server-side. Instead use the
      // mapping table directly.
      displayName = resolveDisplayName({ id: taskId }, taskId);
    }
  } catch { /* ignore — fall back to id */ }

  const baseRecord: HarnessTestResult = {
    tab: tabKey,
    tab_label: tabLabel,
    task_id: taskId,
    display_name: displayName,
    family,
    execution_mode: isConversational ? "conversational" : "repo",
    manifest_loaded: false,
    request_sent: false,
    response_received: false,
    judge_ran: false,
    bundle_stored: false,
    ui_summary_well_formed: false,
    drilldown_evidence_present: false,
    pass: false,
    pass_threshold_percent: 0,
    score_percent: 0,
    bundle_id: null,
    bundle_hash: null,
    model,
    provider,
    prompt_tokens: 0,
    completion_tokens: 0,
    model_cost_usd: 0,
    judge_provider: "",
    judge_model: "",
    judge_prompt_tokens: 0,
    judge_completion_tokens: 0,
    judge_cost_usd: 0,
    total_cost_usd: 0,
    completion_state: null,
    failure_origin: null,
    failure_reason_code: null,
    interpretation: null,
    anomaly_flags: [],
    suspicious_flags: [],
    error_details: null,
    ui_route_hint: null,
    duration_ms: 0,
  };

  try {
    // Phase 1: load manifest. Both runner.ts and conversational-runner.ts
    // throw on missing manifest, so a successful runTask call implies this
    // phase passed. We pre-load conversational manifests explicitly so the
    // harness can fail fast with a useful error before booting an adapter.
    if (isConversational) {
      loadConversationalManifest(taskId);
    }
    baseRecord.manifest_loaded = true;
    baseRecord.request_sent = true; // runTask will dispatch unconditionally below

    // Phase 2-5: drive the full runner.
    const result = isConversational
      ? await runConversationalTask({ taskId, adapter, model, reviewConfig })
      : await runTask({ taskId, adapter, model, keepWorkspace: false, reviewConfig });

    const { bundle } = result;
    storeBundle(bundle);
    baseRecord.bundle_stored = true;
    baseRecord.bundle_id = bundle.bundle_id;
    baseRecord.bundle_hash = bundle.bundle_hash;
    baseRecord.pass = bundle.score.pass;
    baseRecord.pass_threshold_percent = canonicalPercent(bundle.score.pass_threshold);
    baseRecord.score_percent = canonicalPercent(bundle.score.total);

    const inspect = inspectBundle(bundle, baseRecord.execution_mode);
    baseRecord.response_received = inspect.responseReceived;
    baseRecord.judge_ran = inspect.judgeRan;
    baseRecord.drilldown_evidence_present = inspect.drilldownEvidence;
    baseRecord.suspicious_flags = inspect.suspicious;

    // Tested-model usage.
    baseRecord.prompt_tokens = bundle.usage.tokens_in;
    baseRecord.completion_tokens = bundle.usage.tokens_out;
    baseRecord.model_cost_usd = bundle.usage.estimated_cost_usd;

    // Judge-side usage.
    const ju = bundle.judge_usage;
    if (ju) {
      baseRecord.judge_provider = ju.provider;
      baseRecord.judge_model = ju.model;
      baseRecord.judge_prompt_tokens = ju.tokens_in;
      baseRecord.judge_completion_tokens = ju.tokens_out;
      baseRecord.judge_cost_usd = ju.estimated_cost_usd;
    }
    baseRecord.total_cost_usd = baseRecord.model_cost_usd + baseRecord.judge_cost_usd;

    // Anomaly flags from conversational judge.
    const verdict = normalizeBundleVerdict(bundle);
    baseRecord.completion_state = verdict.completionState;
    baseRecord.failure_origin = verdict.failureOrigin;
    baseRecord.failure_reason_code = verdict.failureReasonCode;
    baseRecord.interpretation = bundle.interpretation ?? null;
    if (verdict.failureReasonCode === "judge_not_evaluable" || verdict.failureReasonCode === "judge_failure") {
      baseRecord.suspicious_flags.push(`JUDGE_UNEVALUABLE: ${verdict.failureReasonCode}`);
    }

    // Phase 6 + 7: validate the API summary contract — this is what the UI
    // pulls from /api/runs/:id/summary.
    try {
      const summary = summarizeBundle(bundle, 0, null, [bundle]);
      baseRecord.ui_summary_well_formed = !!summary
        && typeof summary.outcome?.score === "number"
        && typeof summary.judge_usage?.kind === "string"
        && typeof summary.total?.cost_usd === "number";
    } catch (err) {
      baseRecord.ui_summary_well_formed = false;
      baseRecord.suspicious_flags.push(`SUMMARY_CONTRACT_BROKEN: ${String(err).slice(0, 160)}`);
    }

    baseRecord.ui_route_hint = `/?tab=${encodeURIComponent(tabKey)}&run=${encodeURIComponent(bundle.bundle_id)}`;

    // Anomalies bubble up from the conversational judge for personality runs.
    if (isConversational) {
      const verifyDetails = bundle.verification_results.correctness.details ?? {};
      const correctnessKeys = Object.keys(verifyDetails);
      if (correctnessKeys.length === 0) {
        baseRecord.anomaly_flags.push("NO_CORRECTNESS_DETAILS");
      }
    }
  } catch (err) {
    baseRecord.error_details = String(err).slice(0, 400);
    log("error", "harness", `[${taskId}] ${baseRecord.error_details}`);
  }

  baseRecord.duration_ms = Date.now() - start;
  return baseRecord;
}

// ── Selection helpers ───────────────────────────────────────────────────────

interface SelectedTask {
  tabKey: string;
  tabLabel: string;
  taskId: string;
  family: string;
}

function selectTasks(args: HarnessArgs): SelectedTask[] {
  const tabKeys = args.tabs ? new Set(args.tabs.map((t) => t.toLowerCase())) : null;
  const idFilter = args.taskIds ? new Set(args.taskIds) : null;
  const all = listTasks();
  const idToFamily = new Map(all.map((task) => [task.id, task.family]));
  const selected: SelectedTask[] = [];
  for (const lane of HARNESS_LANES) {
    if (tabKeys && !tabKeys.has(lane.key)) continue;
    for (const task of all) {
      if (!lane.taskFamilies.includes(task.family)) continue;
      if (idFilter && !idFilter.has(task.id)) continue;
      selected.push({ tabKey: lane.key, tabLabel: lane.label, taskId: task.id, family: task.family });
    }
  }
  // If the user asked for an explicit task id that doesn't fall into any
  // mapped lane, still include it so the harness can surface "no lane".
  if (idFilter) {
    for (const id of idFilter) {
      if (selected.some((s) => s.taskId === id)) continue;
      const family = idToFamily.get(id) ?? "unknown";
      selected.push({ tabKey: "(unmapped)", tabLabel: "(unmapped)", taskId: id, family });
    }
  }
  return selected;
}

// ── Pretty printing ─────────────────────────────────────────────────────────

function pipelinePhaseGrid(r: HarnessTestResult): string {
  const cell = (ok: boolean) => (ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");
  return [
    `start=${cell(r.manifest_loaded)}`,
    `req=${cell(r.request_sent)}`,
    `resp=${cell(r.response_received)}`,
    `judge=${cell(r.judge_ran)}`,
    `bundle=${cell(r.bundle_stored)}`,
    `ui=${cell(r.ui_summary_well_formed)}`,
    `drill=${cell(r.drilldown_evidence_present)}`,
  ].join(" ");
}

function printResultLine(r: HarnessTestResult): void {
  const status = r.pass
    ? "\x1b[32mPASS\x1b[0m"
    : r.error_details
      ? "\x1b[31mERROR\x1b[0m"
      : "\x1b[33mFAIL\x1b[0m";
  const cost = `${formatCost(r.model_cost_usd)} model + ${formatCost(r.judge_cost_usd)} judge`;
  console.log(`  [${r.tab_label}] ${status} ${r.display_name} (${r.task_id})  ${r.score_percent}%  ${cost}`);
  console.log(`         ${pipelinePhaseGrid(r)}`);
  if (r.suspicious_flags.length) {
    for (const flag of r.suspicious_flags) console.log(`         ! ${flag}`);
  }
  if (r.error_details) {
    console.log(`         error: ${r.error_details}`);
  }
}

// ── Entrypoint ──────────────────────────────────────────────────────────────

export async function harnessCommand(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);
  const selected = selectTasks(args);
  if (!selected.length) {
    console.error("harness: no matching tests. Try `npm run harness -- --tab personality`.");
    process.exit(3);
  }

  let resolved: ResolvedHarnessAdapter;
  try {
    resolved = await buildAdapter(args);
  } catch (err) {
    // CLI-level config errors (unknown adapter, missing key, missing
    // --model) — exit 5 so callers can tell harness errors (3) apart
    // from adapter/config errors (5).
    console.error(String((err as Error).message ?? err));
    process.exit(5);
  }
  const { adapter, adapterId, provider, model, mode } = resolved;
  // Adapters are already initialised by instantiateAdapterForRun for the
  // live path; the mock adapter takes a no-op init. Calling init twice on
  // a live adapter resets credentials, so only run it for the mock path.
  if (mode === "mock") {
    await adapter.init({});
  }
  const health = await adapter.healthCheck();
  if (!health.ok) {
    console.error(`harness adapter health check failed: ${health.reason ?? "unknown"}`);
    process.exit(5);
  }

  console.log("=".repeat(72));
  console.log(` Crucible Harness — ${mode === "live" ? "LIVE" : "MOCK"} adapter (${adapter.name} / ${model})`);
  console.log(`   adapter id : ${adapterId}`);
  console.log(`   provider   : ${provider}`);
  console.log(`   model      : ${model}`);
  console.log(`   mode       : ${mode}`);
  console.log(`   retries    : ${args.retries ?? 1}`);
  console.log(`   timeout ms : ${args.timeoutMs ?? "adapter default"}`);
  console.log(` Tests:  ${selected.length}`);
  console.log(` Lanes:  ${[...new Set(selected.map((s) => s.tabLabel))].join(", ")}`);
  console.log(` Judge:  ${describeDefaultJudge().provider}/${describeDefaultJudge().model}${args.enableJudge ? " (live, advisory)" : " (deterministic only)"}`);
  console.log("=".repeat(72));

  const results: HarnessTestResult[] = [];
  const startedAt = Date.now();
  for (const item of selected) {
    const result = await runOneTest({
      taskId: item.taskId,
      family: item.family,
      tabKey: item.tabKey,
      tabLabel: item.tabLabel,
      adapter,
      model,
      provider,
      enableJudge: args.enableJudge,
      args,
    });
    results.push(result);
    printResultLine(result);
  }
  await adapter.teardown();

  const totals = {
    tabs_run: new Set(results.map((r) => r.tab)).size,
    tests_run: results.length,
    tests_passed: results.filter((r) => r.pass).length,
    tests_failed: results.filter((r) => !r.pass).length,
    failed_model: results.filter((r) => r.completion_state === "FAIL" && r.failure_origin === "MODEL").length,
    failed_provider: results.filter((r) => r.completion_state === "NC" && (r.failure_origin === "PROVIDER" || r.failure_origin === "NETWORK")).length,
    failed_runner: results.filter((r) => r.completion_state === "NC" && (r.failure_origin === "HARNESS" || r.failure_origin === "UNKNOWN")).length,
    failed_judge: results.filter((r) => r.completion_state === "NC" && (r.failure_origin === "JUDGE" || r.failure_origin === "TEST")).length,
    skipped_config: results.filter((r) => !!r.error_details && !r.bundle_stored).length,
    tests_with_anomalies: results.filter((r) => r.suspicious_flags.length > 0 || r.anomaly_flags.length > 0).length,
    pipeline_breaks: results.filter((r) => !r.bundle_stored || !r.ui_summary_well_formed || !r.judge_ran).length,
    model_cost_usd: Math.round(results.reduce((sum, r) => sum + r.model_cost_usd, 0) * 1_000_000) / 1_000_000,
    judge_cost_usd: Math.round(results.reduce((sum, r) => sum + r.judge_cost_usd, 0) * 1_000_000) / 1_000_000,
    total_cost_usd: 0,
    duration_ms: Date.now() - startedAt,
  };
  totals.total_cost_usd = Math.round((totals.model_cost_usd + totals.judge_cost_usd) * 1_000_000) / 1_000_000;

  const report: HarnessReport = {
    generated_at: new Date().toISOString(),
    mode,
    adapter: adapterId,
    provider,
    model,
    judge_config: describeDefaultJudge(),
    totals,
    failing_tests: results.filter((r) => !r.pass || r.suspicious_flags.length > 0),
    results,
  };

  const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  mkdirSync(runsDir, { recursive: true });
  const outPath = args.outputPath
    ?? join(runsDir, `_harness_report_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf-8");

  console.log("=".repeat(72));
  console.log(` Tests:    ${totals.tests_passed} passed / ${totals.tests_failed} failed (${totals.tests_run} total)`);
  console.log(` Outcomes: model=${totals.failed_model} provider=${totals.failed_provider} runner=${totals.failed_runner} judge=${totals.failed_judge} skipped/config=${totals.skipped_config}`);
  console.log(` Anomalies: ${totals.tests_with_anomalies}`);
  console.log(` Pipeline breaks: ${totals.pipeline_breaks}`);
  console.log(` Model cost:  ${formatCost(totals.model_cost_usd)}`);
  console.log(` Judge cost:  ${formatCost(totals.judge_cost_usd)}`);
  console.log(` TOTAL cost:  ${formatCost(totals.total_cost_usd)}`);
  console.log(` Duration:    ${(totals.duration_ms / 1000).toFixed(1)}s`);
  console.log(` Report:      ${outPath}`);
  console.log("=".repeat(72));

  // Exit code 0 only if every test passed cleanly with no pipeline breaks.
  // Test failures alone (model didn't pass) exit 1; pipeline breakage exits 2.
  if (totals.pipeline_breaks > 0) process.exit(2);
  if (totals.tests_failed > 0) process.exit(1);
  process.exit(0);
}
