/**
 * Luak — Adapter Interface
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
  family: "poison_localization" | "spec_discipline" | "orchestration" | "tool_calling";
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
    hash?: string | undefined;
    /** Test fixtures may opt out explicitly; release manifests must not. */
    hash_required?: boolean | undefined;
  };
  metadata: {
    author: string;
    created: string;
    tags: string[];
    diagnostic_purpose: string;
    benchmark_provenance?: BenchmarkProvenance | undefined;
    adversarial_fixture?: PoisonAdversarialFixture | undefined;
  };
  seed: number;
}

export type BenchmarkPublicStatus = "public" | "private" | "mixed";
export type BenchmarkOracleVisibility = "hidden" | "public" | "partially_public";
export type BenchmarkGoldSolutionVisibility = "hidden" | "public" | "not_applicable";
export type ContaminationRisk = "low" | "medium" | "high";

export interface BenchmarkProvenance {
  source: string;
  public_status: BenchmarkPublicStatus;
  oracle_visibility: BenchmarkOracleVisibility;
  gold_solution_visibility: BenchmarkGoldSolutionVisibility;
  contamination_risk: ContaminationRisk;
  known_scoring_limitations: string[];
}

export type PoisonAdversaryKind = "decoy_localization" | "prompt_injection";

export interface PoisonAdversarialFixture {
  kind: PoisonAdversaryKind;
  attacker_instruction: string;
  attack_goal: string;
  expected_safe_behavior: string;
  expected_unsafe_behavior: string;
  refusal_expected: boolean;
  cannot_verify_expected: "pass" | "partial" | "fail";
  tool_execution_required: boolean;
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
    /**
     * Path to the buggy file. Multi-bug tasks (e.g. coord-003 with two
     * interacting bugs across different files) declare this as an array;
     * single-bug tasks keep the original string shape. The judge handles
     * both forms.
     */
    bug_location: string | string[];
    bug_line_range: [number, number] | Array<[number, number]>;
    bug_description: string;
    /** Same shape rule as bug_location — string or array of strings. */
    correct_fix_pattern: string | string[];
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
  retries?: number | undefined;
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
  type: "file_read" | "file_write" | "shell" | "search" | "task_start" | "task_complete" | "provider_attempt" | "error";
  path?: string | undefined;
  command?: string | undefined;
  sanitized_command?: string | undefined;
  cwd?: string | undefined;
  exit_code?: number | undefined;
  detail?: string | undefined;
  provider_error?: StructuredProviderError | undefined;
  retry_decision?: "retry" | "stop" | "not_retryable" | "success" | undefined;
  attempt?: number | undefined;
  error_kind?: string | undefined;
}

export interface ProviderAttemptRecord {
  attempt: number;
  started_at: string;
  duration_ms: number;
  error_type: string | null;
  retry_decision: "retry" | "stop" | "not_retryable" | "success";
  provider_error?: StructuredProviderError | undefined;
}

export interface ExecutionResult {
  exit_reason: "complete" | "timeout" | "budget_exceeded" | "error" | "injection_detected";
  timeline: TimelineEvent[];
  provider_error?: StructuredProviderError | undefined;
  provider_attempts?: ProviderAttemptRecord[] | undefined;
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

/**
 * Multimodal content parts (OpenAI/OpenRouter-compatible shape).
 *
 * Only OpenRouter currently supports image_url forwarding. Other
 * adapters that don't know how to handle parts will throw a
 * structured error from chat() — the conversational runner gates
 * vision tasks behind preflightSkipCheck's
 * `imageTransportImplemented` flag so the unsupported branch is
 * never reached in practice.
 */
export interface ChatContentTextPart {
  type: "text";
  text: string;
}
export interface ChatContentImagePart {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
}
export type ChatContentPart = ChatContentTextPart | ChatContentImagePart;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  /** String for normal text turns. Array of parts for multimodal
   *  turns (text + image_url). The runner only constructs parts for
   *  vision-family tasks where preflight cleared the route. */
  content: string | ChatContentPart[];
}

export interface ChatResult {
  text: string;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  provider_attempts?: ProviderAttemptRecord[] | undefined;
  /**
   * USD cost if the provider surfaces it (OpenRouter does when the request
   * opts into usage metadata). Stays `undefined` for providers that don't
   * report cost; callers must treat missing cost as "unknown", not "zero".
   */
  cost_usd?: number | undefined;
}

export interface SanitizedChatText {
  /** Final visible text used for scoring. */
  text: string;
  /** True when at least one thinking/reasoning block was stripped. */
  strippedVisibleReasoning: boolean;
  /**
   * Original input to the sanitizer, preserved verbatim. Carried back to
   * the runner so per-question evidence can record both raw and visible
   * outputs without callers having to clone the input themselves.
   */
  rawText: string;
  /**
   * Names of the thinking-block patterns that fired (e.g. ["think",
   * "reasoning_tag", "markdown_heading"]). Empty when nothing was
   * stripped. Surfaced in evidence so the drilldown can explain raw
   * vs. visible drift.
   */
  tags: string[];
}

export interface ChatOptions {
  benchmarkMode?: boolean | undefined;
  suppressVisibleReasoning?: boolean | undefined;
  reasoningEffort?: "off" | "minimal" | "default" | undefined;
  retries?: number | undefined;
  timeoutMs?: number | undefined;
  /**
   * Hard cap on output tokens for this call. Adapters that support it forward
   * it as the provider's `max_tokens` / `maxOutputTokens`. Optional — when
   * unset the adapter's own default applies. Used by experimental cost-capped
   * benchmark runs to keep spend bounded (see docs/MINIMAX_M3_EXPERIMENTAL.md).
   */
  maxTokens?: number | undefined;
  /** Internal harness hint for deterministic mock adapters; ignored by live adapters. */
  currentQuestion?: ConversationalQuestion | undefined;
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
  | "thinking-mode"
  | "operational_trust"
  // Experimental scaffolds — see docs/ROLEPLAY_TEST_SUITE.md +
  // docs/MULTIMODAL_VISION_SUITE.md. Excluded from leaderboard
  // composite by default; runner gates vision behind preflight.
  | "roleplay"
  | "vision";

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
  | "numeric_fact_match"
  | "uncertainty_honesty"
  | "absence_honesty"
  | "roleplay_character_consistency"
  | "roleplay_continuity_fact_match"
  | "custom";

/** Single fact for roleplay_continuity_fact_match. The model's answer
 *  is accepted as "recalled" if any of `variants` appears as a
 *  case-insensitive substring. `label` is human-only and shows up in
 *  the failure reason for operator legibility. */
export interface RoleplayFact {
  label: string;
  variants: string[];
}

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
  /** When true, the regex_match pattern is compiled WITHOUT the "i" flag so
   *  case-sensitivity checks (e.g. an ALL-UPPERCASE obedience test) are
   *  meaningful. Defaults to false → case-insensitive for backward
   *  compatibility. (Audit S3.) */
  case_sensitive?: boolean | undefined;
  // ── numeric_fact_match (vision-recognition scoring) ───────────────
  /** Expected numeric value (e.g. 7) — accepted as digit or spelled-out
   *  variants (see expected_number_variants). The answer must contain
   *  this number anywhere within `max_chars`, AND must not contain a
   *  contradicting number that appears LIKE the answer (e.g. answering
   *  "6 red dots" when the truth is 7 is a fail). */
  expected_number?: number | undefined;
  /** Optional explicit accepted variants: ["7","seven","Seven"]. If
   *  omitted, the scorer auto-builds digit + lowercased English word. */
  expected_number_variants?: string[] | undefined;
  /** Optional object/colour phrase the answer MUST mention (e.g.
   *  "red dots"). Match is case-insensitive substring. Use empty/null
   *  to skip the object check. */
  required_object?: string | undefined;
  /** Optional list of accepted object/colour phrases. When present, the
   *  answer passes the object check if it mentions ANY variant (case-
   *  insensitive substring) — e.g. ["red dot","red circle","red dots",
   *  "red circles"] so "7 red circles" is accepted (dots ARE circles).
   *  Takes precedence over required_object when both are set. (Audit
   *  vision-object-count-001.) */
  required_object_variants?: string[] | undefined;
  /** Soft length cap for verbose answers. Default 180 chars. Verbose
   *  answers beyond this are fail with "answer too long" reason —
   *  but the cap is much higher than regex_match's maxLength so
   *  natural-language recognition answers pass. */
  max_chars?: number | undefined;

  // ── absence_honesty (Phase 14 Vision hallucination-resistance) ───
  /** Object the prompt asks about that is intentionally NOT in the
   *  image. The scorer derives denial/presence cues from this token
   *  (e.g. "banana"). Required for scoring_type: "absence_honesty". */
  absent_object?: string | undefined;

  // ── roleplay_character_consistency (Phase 10 roleplay POC) ────────
  /** Persona markers — case-insensitive substrings. At least ONE must
   *  appear in the answer for character_consistency PASS. Examples for
   *  Ember the blacksmith: ["forge","metal","hammer","anvil"]. */
  required_persona_markers?: string[] | undefined;
  /** Banned generic-assistant / meta phrases — if ANY appears the
   *  response is FAIL_PRODUCT for breaking character. Defaults are
   *  applied by the scorer; this list ADDS scenario-specific items. */
  banned_meta_phrases?: string[] | undefined;
  /** If true, the answer MUST contain at least one refusal indicator
   *  (e.g. "won't", "refuse", "can't do that") AND must do so without
   *  a generic-AI safety boilerplate. Used by scenarios that ask the
   *  in-character refusal of something the persona has flagged. */
  expects_refusal?: boolean | undefined;

  // ── roleplay_continuity_fact_match (Phase 10 roleplay POC) ────────
  /** Required facts — every fact must have AT LEAST ONE of its
   *  `variants` appear in the answer (case-insensitive substring).
   *  Missing any fact ⇒ FAIL_PRODUCT. */
  required_facts?: RoleplayFact[] | undefined;
  /** Optional facts — partial credit. If a required fact is missing
   *  but at least one optional fact landed, scorer returns
   *  NEEDS_REVIEW instead of FAIL_PRODUCT. */
  optional_facts?: RoleplayFact[] | undefined;
  /** Phrases that, if present, indicate the model exited the
   *  scene / broke continuity (e.g. "I don't have memory",
   *  "as an AI language model"). Auto-augmented by scorer defaults. */
  forbidden_continuity_phrases?: string[] | undefined;
  /** When true, forbidden_continuity_phrases are routed through the
   *  negation classifier before failing: a banned word used in a
   *  correction ("I'm Korin the scribe, not a warrior", "I'm no guard")
   *  is the *right* answer and must not trigger FAIL_PRODUCT. A banned
   *  phrase only fails when asserted or mentioned without negation.
   *  Defaults to false → strict substring match (back-compat). */
  negation_aware?: boolean | undefined;
}

export interface ConversationalManifest {
  id: string;
  version: string;
  family: ConversationalFamily;
  execution_mode: "conversational";
  difficulty: "easy" | "medium" | "hard";
  description: string;
  system_prompt?: string | undefined;
  /**
   * Per-task thinking-mode policy. Lets a manifest opt out of visible
   * reasoning explicitly without globally disabling thinking for everyone.
   *   "off"     — request `reasoning_effort=off` at the adapter where
   *               supported (OpenRouter native, MiniMax, etc.) AND fall
   *               back to sanitization. Used for short-answer
   *               conversational tasks.
   *   "minimal" — request the lightest reasoning effort the provider
   *               offers. Sanitization still runs.
   *   "default" — leave reasoning policy to the family default.
   *   "preserve"— do not strip thinking tags, even for non-thinking-mode
   *               families. Used by the dedicated thinking-mode lane.
   * Unset = inherit family default (currently: thinking-mode preserves,
   * everything else sanitizes).
   */
  thinking_mode?: "off" | "minimal" | "default" | "preserve" | undefined;
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
    benchmark_provenance?: BenchmarkProvenance | undefined;
  };
}

export interface ConversationalResult {
  question_id: string;
  question: string;
  /** Visible response after sanitization — what the deterministic judge sees. */
  response: string;
  /**
   * Original adapter response, preserved verbatim before any sanitization.
   * Stays in evidence so audits can reproduce what the model actually
   * emitted (including stripped `<think>` blocks).
   */
  raw_response?: string | undefined;
  /** True when sanitization removed visible chain-of-thought before scoring. */
  stripped_visible_reasoning?: boolean | undefined;
  /**
   * Names the patterns the sanitizer matched (e.g. ["think", "reasoning"]).
   * Empty when nothing was stripped. Carried in evidence so the drilldown
   * can explain *why* raw and visible diverge instead of leaving operators
   * to spot the diff manually.
   */
  sanitization_tags?: string[] | undefined;
  /**
   * Number of newline-separated lines in the visible response. Set on
   * regex_match scoring (line-budget tasks) so the drilldown can expose
   * "X lines, max Y" without re-counting from raw text.
   */
  line_count?: number | undefined;
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
    // "unsupported" = a regression check with no runnable command; it is
    // excluded from the score rather than counted as a free pass. (Audit H6.)
    details: Record<string, "pass" | "fail" | "unsupported">;
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
  /**
   * Server-issued run id from POST /api/run that produced this bundle.
   * Optional because legacy bundles + CLI-harness invocations have no
   * dispatch id. When present, lets /api/runs/<runId> hydrate the right
   * evidence even though `bundle_id` is now a separate random-suffixed
   * slug that no client sees.
   */
  run_id?: string | undefined;
  /** HMAC-SHA256 over `${bundle_id}.${bundle_hash}`. Missing means legacy/unverified. */
  signature?: string | undefined;
  bundle_version: string;
  task: {
    id: string;
    manifest_hash: string;
    family: string;
    difficulty: string;
    benchmark_provenance?: BenchmarkProvenance | undefined;
  };
  oracle_integrity?: {
    oracle_hash_verified: boolean;
    oracle_hash_status: "valid" | "missing" | "mismatch" | "malformed" | "placeholder" | "not_required";
    oracle_hash_expected: string | null;
    oracle_hash_actual: string | null;
  } | undefined;
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
  provider_attempts?: ProviderAttemptRecord[] | undefined;
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
    /** Model id of the judge (e.g. "xiaomi/mimo-v2.5-pro"). Empty when none ran. */
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
  poison_evaluation?: {
    category:
      | "PASS"
      | "TRUE_COMPROMISE"
      | "SAFE_BUT_UNHELPFUL"
      | "PARSER_FAILURE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "EMPTY_RESPONSE"
      | "RUBRIC_MISMATCH"
      | "PREFLIGHT_BLOCKED"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
  benchmark_evaluation?: {
    category:
      | "PASS"
      | "PARTIAL"
      | "WRONG_ANSWER"
      | "SAFE_BUT_UNHELPFUL"
      | "EMPTY_RESPONSE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "PARSER_FAILURE"
      | "RUBRIC_MISMATCH"
      | "AMBIGUOUS_FIXTURE"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
  build_evaluation?: {
    category:
      | "PASS"
      | "PARTIAL"
      | "WRONG_EDIT"
      | "NO_EDIT"
      | "BUILD_FAILED"
      | "TEST_FAILED"
      | "PREEXISTING_REPO_FAILURE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "EMPTY_RESPONSE"
      | "SANDBOX_FAILURE"
      | "PARSER_FAILURE"
      | "RUBRIC_MISMATCH"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
  safety_evaluation?: {
    category:
      | "PASS"
      | "SAFE_REFUSAL"
      | "SAFE_COMPLETION"
      | "OVER_REFUSAL"
      | "UNSAFE_COMPLIANCE"
      | "POLICY_AMBIGUOUS"
      | "EMPTY_RESPONSE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "PARSER_FAILURE"
      | "JUDGE_FAILURE"
      | "RUBRIC_MISMATCH"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
  memory_evaluation?: {
    category:
      | "PASS"
      | "PARTIAL"
      | "RECALL_FAILURE"
      | "UPDATE_FAILURE"
      | "FORGET_FAILURE"
      | "SCOPE_LEAK"
      | "CONTEXT_ONLY_NOT_MEMORY"
      | "STALE_MEMORY_CONTAMINATION"
      | "EMPTY_RESPONSE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "PARSER_FAILURE"
      | "RUBRIC_MISMATCH"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
  personality_evaluation?: {
    category:
      | "PASS"
      | "STRONG_PERSONALITY"
      | "ADEQUATE_PERSONALITY"
      | "WEAK_PERSONALITY"
      | "OVERDONE_ROLEPLAY"
      | "TRUTHFUL_BUT_FLAT"
      | "STYLE_MISMATCH"
      | "EMPTY_RESPONSE"
      | "PROVIDER_FAILURE"
      | "TIMEOUT"
      | "JUDGE_FAILURE"
      | "PARSER_FAILURE"
      | "RUBRIC_MISMATCH"
      | "UNKNOWN";
    score_basis: string[];
    reflects_model_capability: boolean;
    failure_is_infrastructure: boolean;
    raw_or_summary_reason: string;
  } | undefined;
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
    // Howa truthfulness review — advisory. Optional so bundles produced before
    // the Howa integration (and the no-review fast path) still typecheck.
    howaReview?: {
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
  interpretation?: {
    verdict: "pass" | "fail" | "skipped" | "provider-failed" | "runner-failed" | "judge-failed";
    reason: string;
    evidence_summary: string;
    reflects_model_capability: boolean;
    provider_or_retry_affected_confidence: boolean;
    cost_usd: number;
    duration_ms: number;
    recommended_interpretation: string;
  } | undefined;
  synthesis?: SynthesisReport | undefined;
  /**
   * Per-question conversational evidence. Only populated for conversational
   * runs. Carries raw and sanitized responses, sanitization tags and line
   * counts so the receipt/drilldown can show why a refusal counted, why a
   * line-budget task tripped, or whether thinking-mode bloat was the cause.
   * Populating this on the bundle (and not as opaque correctness.details)
   * is what lets us separate adapter/sanitizer issues from real model
   * capability failures during calibration.
   */
  conversational?: {
    results: ConversationalResult[];
  } | undefined;
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
