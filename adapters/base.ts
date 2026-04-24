/**
 * Crucible — Adapter Interface
 * Every adapter implements this contract. No exceptions.
 */

import type { JudgeCommandResult } from "../core/verdict.js";
import type { StructuredProviderError } from "../types/provider-error.js";
import type { NormalizedVerdict } from "../types/verdict.js";

// ── Agent-visible manifest (filtered — no oracle, no scoring weights) ──────

export interface AgentVisibleManifest {
  task: {
    title: string;
    description: string;
    entrypoints: string[];
  };
  constraints: {
    time_limit_sec: number;
    max_steps: number;
    allowed_tools: string[];
    network_allowed: boolean;
  };
  verification: {
    public_tests_command: string | null;
    build_command: string | null;
  };
}

// ── Full manifest (judge sees this) ────────────────────────────────────────

export interface TaskManifest {
  id: string;
  version: string;
  family: "poison_localization" | "spec_discipline" | "orchestration";
  difficulty: "easy" | "medium" | "hard";
  repo: {
    source: string;
    path: string;
    commit: string;
    setup_script: string | null;
    reset_script: string | null;
  };
  task: {
    title: string;
    description: string;
    entrypoints: string[];
    hints_allowed: boolean;
  };
  constraints: {
    time_limit_sec: number;
    max_steps: number;
    max_file_edits: number;
    max_files_read: number;
    allowed_tools: string[];
    forbidden_paths: string[];
    network_allowed: boolean;
  };
  verification: {
    public_tests_command: string | null;
    build_command: string | null;
    runtime_command: string | null;
    lint_command: string | null;
  };
  scoring: {
    weights: {
      correctness: number;
      regression: number;
      integrity: number;
      efficiency: number;
    };
    pass_threshold: number;
  };
  oracle_ref: {
    type: string;
    path: string;
    hash: string;
  };
  metadata: {
    author: string;
    created: string;
    tags: string[];
    diagnostic_purpose: string;
  };
  seed: number;
}

// ── Oracle ─────────────────────────────────────────────────────────────────

export interface OracleCheck {
  id: string;
  type: "hidden_test" | "api_check" | "test_suite" | "build" | "lint" | "forbidden_edit" | "diff_rule";
  command?: string | undefined;
  pass_condition?: string | undefined;
  weight?: number | undefined;
  endpoint?: string | undefined;
  method?: string | undefined;
  input?: Record<string, unknown> | undefined;
  expected?: Record<string, unknown> | undefined;
  paths?: string[] | undefined;
  severity?: "hard_fail" | "penalty" | undefined;
  rule?: string | undefined;
  target_pattern?: string | undefined;
  value?: number | undefined;
}

export interface OracleDecoy {
  description: string;
  path: string;
  is_real_bug: boolean;
  diagnostic: string;
}

export interface Oracle {
  task_id: string;
  version: string;
  hash: string;
  ground_truth: {
    bug_location: string;
    bug_line_range: [number, number];
    bug_description: string;
    correct_fix_pattern: string;
  };
  checks: {
    correctness: OracleCheck[];
    regression: OracleCheck[];
    integrity: OracleCheck[];
    anti_cheat: {
      forbidden_code_patterns: string[];
      forbidden_comment_patterns: string[];
      suspicious_behaviors: string[];
    };
    decoys: OracleDecoy[];
  };
}

// ── Adapter types ──────────────────────────────────────────────────────────

export interface AdapterConfig {
  timeout_ms?: number | undefined;
  extra_flags?: string[] | undefined;
  env?: Record<string, string> | undefined;
}

export interface HealthCheckResult {
  ok: boolean;
  reason?: string | undefined;
  providerError?: StructuredProviderError | undefined;
}

export interface ExecutionInput {
  task: AgentVisibleManifest;
  workspace_path: string;
  budget: {
    time_limit_sec: number;
    max_steps: number;
    max_file_edits: number;
    network_allowed: boolean;
  };
}

export interface TimelineEvent {
  t: number;
  type: "file_read" | "file_write" | "shell" | "search" | "task_start" | "task_complete" | "error";
  path?: string | undefined;
  command?: string | undefined;
  exit_code?: number | undefined;
  detail?: string | undefined;
  provider_error?: StructuredProviderError | undefined;
}

export interface ExecutionResult {
  exit_reason: "complete" | "timeout" | "budget_exceeded" | "error" | "injection_detected";
  timeline: TimelineEvent[];
  provider_error?: StructuredProviderError | undefined;
  duration_ms: number;
  steps_used: number;
  files_read: string[];
  files_written: string[];
  tokens_in?: number | undefined;
  tokens_out?: number | undefined;
  adapter_metadata: {
    adapter_id: string;
    adapter_version: string;
    system_version: string;
    model: string;
    provider: string;
  };
}

// ── Chat types (conversational tasks) ─────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  /**
   * USD cost if the provider surfaces it (OpenRouter does when the request
   * opts into usage metadata). Stays `undefined` for providers that don't
   * report cost; callers must treat missing cost as "unknown", not "zero".
   */
  cost_usd?: number | undefined;
}

export interface SanitizedChatText {
  text: string;
  strippedVisibleReasoning: boolean;
}

export interface ChatOptions {
  benchmarkMode?: boolean | undefined;
  suppressVisibleReasoning?: boolean | undefined;
  reasoningEffort?: "off" | "minimal" | "default" | undefined;
}

// ── Conversational task types ─────────────────────────────────────────────

export type ConversationalFamily =
  | "identity"
  | "truthfulness"
  | "safety"
  | "memory"
  | "proactive"
  | "personality"
  | "adversarial_chat"
  | "cost_efficiency"
  | "classification"
  | "code"
  | "workflow"
  | "instruction-obedience"
  | "prompt-sensitivity"
  | "role-stress"
  | "context-degradation"
  | "reasoning"
  | "summarization"
  | "token-efficiency"
  | "thinking-mode";

export type ConversationalScoringType =
  | "text_match"
  | "text_match_all"
  | "refusal_check"
  | "refusal_quality"
  | "recall"
  | "correction"
  | "proactive"
  | "tool_verification"
  | "hedge_count"
  | "corporate_check"
  | "regex_match"
  | "custom";

export interface ConversationalQuestion {
  id: string;
  question: string;
  setup?: string | undefined;
  setup_gap?: number | undefined;
  scoring_type: ConversationalScoringType;
  pass_phrases?: string[] | undefined;
  fail_phrases?: string[] | undefined;
  weight: number;
  tags: string[];
  expected_tool?: string | undefined;
  /** Custom scoring function name (for scoring_type: "custom") */
  custom_scorer?: string | undefined;
  /** Regex pattern for scoring_type: "regex_match" */
  pattern?: string | undefined;
  /** Max response length for scoring_type: "regex_match" */
  maxLength?: number | undefined;
}

export interface ConversationalManifest {
  id: string;
  version: string;
  family: ConversationalFamily;
  execution_mode: "conversational";
  difficulty: "easy" | "medium" | "hard";
  description: string;
  system_prompt?: string | undefined;
  /** Gap filler messages for recall tests */
  gap_fillers?: string[] | undefined;
  /**
   * Optional session-resume settings for memory-style evaluations.
   * When resume is true, the harness reloads the prior conversation transcript
   * for the same session_id before running this manifest.
   */
  session?: {
    session_id: string;
    resume?: boolean | undefined;
  } | undefined;
  /**
   * Optional conversational execution constraints.
   * These are used by the harness for efficiency scoring and time-budget checks.
   */
  constraints?: {
    time_limit_sec?: number | undefined;
    max_total_tokens?: number | undefined;
  } | undefined;
  questions: ConversationalQuestion[];
  scoring: {
    pass_threshold: number;
  };
  metadata: {
    author: string;
    created: string;
    tags: string[];
    diagnostic_purpose: string;
  };
}

export interface ConversationalResult {
  question_id: string;
  question: string;
  response: string;
  passed: boolean;
  score: number;
  weight: number;
  failure_reason: string | null;
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
}

export interface CrucibulumAdapter {
  id: string;
  name: string;
  version: string;
  supports(family: "poison" | "spec" | "orchestration"): boolean;
  supportsChat(): boolean;
  supportsToolCalls(): boolean;
  init(config: AdapterConfig): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
  teardown(): Promise<void>;
  execute(input: ExecutionInput): Promise<ExecutionResult>;
  /** Send a chat message and get a response. Required for conversational tasks. */
  chat?(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

// ── Evidence Bundle ────────────────────────────────────────────────────────

export interface DiffEntry {
  path: string;
  lines_added: number;
  lines_removed: number;
  patch: string;
}

export interface VerificationResults {
  correctness: {
    score: number;
    details: Record<string, "pass" | "fail" | "unsupported">;
    /**
     * True when every correctness check was marked "unsupported" — i.e. the
     * judge had nothing it could actually evaluate. A score of 0 here means
     * "not evaluable", not "failed zero". Always check this before treating
     * correctness as a real measurement.
     */
    not_evaluable?: boolean;
    command_results?: JudgeCommandResult[] | undefined;
  };
  regression: {
    score: number;
    details: Record<string, "pass" | "fail">;
    command_results?: JudgeCommandResult[] | undefined;
  };
  integrity: {
    score: number;
    details: Record<string, "pass" | "fail">;
    violations: string[];
  };
  efficiency: {
    time_sec: number;
    time_limit_sec: number;
    steps_used: number;
    steps_limit: number;
    score: number;
  };
}

export interface EvidenceBundle {
  bundle_id: string;
  bundle_hash: string;
  bundle_version: string;
  task: {
    id: string;
    manifest_hash: string;
    family: string;
    difficulty: string;
  };
  agent: {
    adapter: string;
    adapter_version: string;
    system: string;
    system_version: string;
    model: string;
    model_version: string;
    provider: string;
  };
  environment: {
    os: string;
    arch: string;
    repo_commit: string;
    crucibulum_version: string;
    timestamp_start: string;
    timestamp_end: string;
  };
  timeline: TimelineEvent[];
  diff: {
    files_changed: DiffEntry[];
    files_created: string[];
    files_deleted: string[];
    forbidden_paths_touched: string[];
  };
  security: {
    injection_scan: "clean" | "detected";
    forbidden_paths_violations: number;
    anti_cheat_violations: number;
    workspace_escape_attempts: number;
  };
  verification_results: VerificationResults;
  score: {
    scale: "fraction_0_1";
    total: number;
    total_percent: number;
    breakdown: {
      correctness: number;
      regression: number;
      integrity: number;
      efficiency: number;
    };
    breakdown_percent: {
      correctness: number;
      regression: number;
      integrity: number;
      efficiency: number;
    };
    pass: boolean;
    pass_threshold: number;
    pass_threshold_percent: number;
    integrity_violations: number;
  };
  usage: {
    tokens_in: number;
    tokens_out: number;
    estimated_cost_usd: number;
    provider_cost_note: string;
  };
  /**
   * Token + cost spent by the JUDGE / scorer model itself, kept separate from
   * `usage` (which is the model under test). When the judge runs purely on
   * deterministic text matching this is all zero. When a model judge / review
   * layer is invoked, the operator can see exactly what was paid for the
   * scoring step versus the answer step.
   */
  judge_usage?: {
    /** Provider id of the judge model (e.g. "openrouter"). Empty when no model judge ran. */
    provider: string;
    /** Model id of the judge (e.g. "xiaomi/mimo-v2-pro"). Empty when none ran. */
    model: string;
    tokens_in: number;
    tokens_out: number;
    estimated_cost_usd: number;
    /**
     * "deterministic" — no model call (the default). Cost will be zero.
     * "model" — a model judge ran and the cost is provider-reported or estimated.
     * "skipped" — judge call was attempted but skipped (e.g. provider offline).
     */
    kind: "deterministic" | "model" | "skipped";
    /** Free-form note: estimate vs provider-reported, or skip reason. */
    note: string;
  } | undefined;
  judge: {
    kind: "deterministic";
    label: string;
    description: string;
    verifier_model: string | null;
    components: string[];
  };
  trust: {
    rubric_hidden: boolean;
    narration_ignored: boolean;
    state_based_scoring: boolean;
    bundle_verified: boolean;
    deterministic_judge_authoritative: boolean;
    review_layer_advisory: boolean;
  };
  diagnosis: {
    localized_correctly: boolean;
    avoided_decoys: boolean;
    first_fix_correct: boolean;
    self_verified: boolean;
    failure_mode: string | null;
  };
  review?: {
    authority: "advisory";
    deterministic_result_authoritative: true;
    security: {
      review_input_scanned: boolean;
      review_input_sanitized: boolean;
      injection_flags_count: number;
      flagged_sources: string[];
      flagged_artifacts: string[];
      review_blocked_reason: string | null;
      review_output_invalid: boolean;
      trust_boundary_violations: string[];
    };
    secondOpinion: {
      enabled: boolean;
      provider: string;
      model: string;
      status: "completed" | "invalid_output" | "blocked_injection" | "error" | "skipped";
      summary: string;
      flags: string[];
      confidence: "high" | "medium" | "low";
      recommendation: "accept" | "rerun" | "challenge" | null;
      disagreement: boolean;
      error?: string | undefined;
      tokens_in?: number | undefined;
      tokens_out?: number | undefined;
      duration_ms?: number | undefined;
    };
    qcReview: {
      enabled: boolean;
      provider: string;
      model: string;
      status: "completed" | "invalid_output" | "blocked_injection" | "error" | "skipped";
      summary: string;
      flags: string[];
      confidence: "high" | "medium" | "low";
      recommendation: "accept" | "rerun" | "challenge" | null;
      disagreement: boolean;
      error?: string | undefined;
      tokens_in?: number | undefined;
      tokens_out?: number | undefined;
      duration_ms?: number | undefined;
    };
  };
  integrations?: {
    veritor?: {
      contract_version: string;
      consumable: boolean;
    };
    paedagogus?: {
      contract_version: string;
      consumable: boolean;
      routing_signals: {
        task_family: string;
        difficulty: string;
        provider: string;
        adapter: string;
        score: number;
        pass: boolean;
        failure_mode: string | null;
      };
    };
    crucible?: {
      profile_id: string | null;
      benchmark_score: number | null;
      benchmark_label: string | null;
      execution_score: number;
      divergence_note: string | null;
    };
  };
  verdict?: NormalizedVerdict | undefined;
  synthesis?: SynthesisReport | undefined;
}

// ── Synthesis Layer (Veritor Mode) ────────────────────────────────────────

export interface SynthesisClaim {
  id: string;
  text: string;
  normalized: string;
  source: "output" | "verification" | "diagnosis";
}

export interface SynthesisModelEntry {
  provider: string;
  model: string;
  run_id: string;
  claims: SynthesisClaim[];
  passed: boolean;
  score: number;
  failure_mode: string | null;
}

export interface ConsensusGroup {
  claim: string;
  supporting_models: string[];
  count: number;
}

export interface OutlierGroup {
  claim: string;
  model: string;
  run_id: string;
}

export interface Disagreement {
  topic: string;
  positions: Array<{ claim: string; models: string[] }>;
}

export interface TruthAlignment {
  consensus_correct: boolean;
  outlier_correct: boolean;
  anti_consensus: boolean;
  notes: string;
}

export interface SynthesisRecommendation {
  best_model: string | null;
  reason: string;
  confidence: number;
}

export interface SynthesisSecurityReport {
  synthesis_input_scanned: boolean;
  synthesis_input_sanitized: boolean;
  injection_flags_count: number;
  flagged_run_ids: string[];
}

export interface SynthesisReport {
  status: "not_run" | "completed" | "error";
  task_id: string;
  run_ids: string[];
  models: SynthesisModelEntry[];
  consensus: ConsensusGroup[];
  outliers: OutlierGroup[];
  disagreements: Disagreement[];
  truth_alignment: TruthAlignment;
  recommendation: SynthesisRecommendation | null;
  security: SynthesisSecurityReport;
  timestamp: string;
  error?: string | undefined;
}
