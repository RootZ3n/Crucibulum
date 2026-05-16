import type { EvidenceBundle, VerificationResults } from "../adapters/base.js";
import type { StructuredProviderError } from "../types/provider-error.js";
import type { FailureOrigin, FailureReasonCode, NormalizedVerdict, VerdictEvidence } from "../types/verdict.js";
import { PASS_VERDICT } from "../types/verdict.js";
import { providerErrorSummary } from "./provider-errors.js";

export interface JudgeCommandResult {
  id: string;
  scope: "correctness" | "regression";
  command: string;
  status: "pass" | "fail" | "error" | "unsupported";
  summary: string;
  exitCode?: number | null;
  timedOut?: boolean | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  errorKind?: "timeout" | "spawn_error" | "runtime_error" | "unevaluable" | undefined;
}

interface FailureMatch {
  origin: FailureOrigin;
  code: FailureReasonCode;
  summary: string;
  httpStatus?: number | undefined;
  timeout?: boolean | undefined;
}

export interface VerdictInput {
  bundle: Pick<EvidenceBundle, "agent" | "score" | "diagnosis" | "verification_results" | "timeline"> & {
    verdict?: NormalizedVerdict | undefined;
  };
  executionMode?: "repo" | "conversational";
  exitReason?: string | null;
  rawError?: string | null;
  providerError?: StructuredProviderError | null;
  attemptCount?: number | null;
  retries?: number | null;
}

function baseEvidence(input: VerdictInput, overrides?: Partial<VerdictEvidence>): VerdictEvidence {
  return {
    provider: input.bundle.agent.provider ?? null,
    adapter: input.bundle.agent.adapter ?? null,
    exitReason: input.exitReason ?? null,
    rawError: input.rawError ?? null,
    providerError: input.providerError ?? null,
    httpStatus: null,
    timeout: false,
    judgeError: null,
    testError: null,
    attemptCount: input.attemptCount ?? null,
    retries: input.retries ?? null,
    ...overrides,
  };
}

function fail(
  completionState: NormalizedVerdict["completionState"],
  origin: FailureOrigin,
  code: FailureReasonCode,
  summary: string,
  evidence: VerdictEvidence,
): NormalizedVerdict {
  return {
    completionState,
    failureOrigin: origin,
    failureReasonCode: code,
    failureReasonSummary: summary,
    countsTowardModelScore: completionState !== "NC",
    countsTowardFailureRate: completionState === "FAIL" && origin === "MODEL",
    evidence,
  };
}

function collectJudgeCommandResults(verification: VerificationResults): JudgeCommandResult[] {
  const correctness = verification.correctness.command_results ?? [];
  const regression = verification.regression.command_results ?? [];
  return [...correctness, ...regression];
}

function classifyJudgeOrTestFailure(
  verification: VerificationResults,
  evidence: VerdictEvidence,
): NormalizedVerdict | null {
  const commandResults = collectJudgeCommandResults(verification);
  const firstError = commandResults.find((result) => result.status === "error");
  if (firstError) {
    const origin: FailureOrigin = firstError.scope === "correctness" ? "JUDGE" : "TEST";
    const code: FailureReasonCode =
      firstError.timedOut ? (origin === "JUDGE" ? "judge_command_timeout" : "test_command_timeout")
        : firstError.errorKind === "unevaluable" ? "judge_not_evaluable"
          : origin === "JUDGE" ? "judge_failure" : "test_harness_failure";
    const summary = firstError.summary;
    return fail("NC", origin, code, summary, {
      ...evidence,
      timeout: !!firstError.timedOut,
      judgeError: origin === "JUDGE" ? summary : evidence.judgeError,
      testError: origin === "TEST" ? summary : evidence.testError,
      rawError: evidence.rawError ?? summary,
    });
  }
  if (verification.correctness.not_evaluable) {
    return fail("NC", "JUDGE", "judge_not_evaluable", "Evaluator produced no usable correctness signal", {
      ...evidence,
      judgeError: "Correctness checks were not evaluable",
      rawError: evidence.rawError ?? "Correctness checks were not evaluable",
    });
  }
  return null;
}

function classifyLegacyTransportFailureText(rawText: string): FailureMatch | null {
  const text = rawText.toLowerCase();
  const httpMatch = text.match(/\b(?:returned|http)\s+(\d{3})\b/);
  const httpStatus = httpMatch ? Number(httpMatch[1]) : undefined;

  if (text.includes("rate limit") || httpStatus === 429) {
    return { origin: "PROVIDER", code: "provider_rate_limited", summary: "Provider rate limited the request", httpStatus };
  }
  if (text.includes("empty content") || text.includes("empty response")) {
    return { origin: "PROVIDER", code: "provider_empty_response", summary: "Provider returned an empty response", httpStatus };
  }
  if (text.includes("connection reset") || text.includes("econnreset")) {
    return { origin: "NETWORK", code: "network_connection_reset", summary: "Network connection was reset", httpStatus };
  }
  if (text.includes("enotfound") || text.includes("eai_again") || text.includes("unreachable") || text.includes("network error")) {
    return { origin: "NETWORK", code: "network_unreachable", summary: "Network path to the provider failed", httpStatus };
  }
  if (text.includes("timeout") || text.includes("timed out") || text.includes("aborterror")) {
    return {
      origin: text.includes("network") ? "NETWORK" : "PROVIDER",
      code: "provider_timeout",
      summary: "Provider request timed out before completion",
      httpStatus,
      timeout: true,
    };
  }
  if (httpStatus && httpStatus >= 500) {
    return { origin: "PROVIDER", code: "provider_http_5xx", summary: `Provider returned HTTP ${httpStatus}`, httpStatus };
  }
  if (httpStatus && httpStatus >= 400) {
    return { origin: "PROVIDER", code: "provider_http_error", summary: `Provider returned HTTP ${httpStatus}`, httpStatus };
  }
  if (text.includes("circuit breaker open")) {
    return { origin: "PROVIDER", code: "provider_error", summary: "Provider adapter circuit breaker blocked execution" };
  }
  if (text.includes("model call failed") || text.includes("provider")) {
    return { origin: "PROVIDER", code: "provider_error", summary: "Provider request failed before the run completed", httpStatus };
  }
  return null;
}

function classifyStructuredProviderFailure(error: StructuredProviderError): FailureMatch {
  switch (error.kind) {
    case "TIMEOUT":
      return {
        origin: error.origin === "NETWORK" ? "NETWORK" : "PROVIDER",
        code: "provider_timeout",
        summary: "Provider request timed out before completion",
        httpStatus: error.statusCode ?? undefined,
        timeout: true,
      };
    case "RATE_LIMIT":
      return {
        origin: "PROVIDER",
        code: "provider_rate_limited",
        summary: error.statusCode ? `Provider rate limited the request (${error.statusCode})` : "Provider rate limited the request",
        httpStatus: error.statusCode ?? undefined,
      };
    case "CONNECTION_RESET":
      return { origin: "NETWORK", code: "network_connection_reset", summary: "Network connection was reset" };
    case "DNS":
      return { origin: "NETWORK", code: "network_dns_failure", summary: "DNS resolution failed while reaching the provider" };
    case "NETWORK":
      return { origin: "NETWORK", code: "network_unreachable", summary: "Network path to the provider failed" };
    case "HTTP_5XX":
      return {
        origin: "PROVIDER",
        code: "provider_http_5xx",
        summary: error.statusCode ? `Provider returned HTTP ${error.statusCode}` : "Provider returned a 5xx error",
        httpStatus: error.statusCode ?? undefined,
      };
    case "HTTP_4XX":
      return {
        origin: "PROVIDER",
        code: "provider_http_error",
        summary: error.statusCode ? `Provider returned HTTP ${error.statusCode}` : "Provider returned a 4xx error",
        httpStatus: error.statusCode ?? undefined,
      };
    case "AUTH":
      return {
        origin: "PROVIDER",
        code: "provider_auth_error",
        summary: error.statusCode ? `Provider authentication failed (${error.statusCode})` : "Provider authentication failed",
        httpStatus: error.statusCode ?? undefined,
      };
    case "UNAVAILABLE":
      return {
        origin: "PROVIDER",
        code: "provider_unavailable",
        summary: error.statusCode ? `Provider unavailable (${error.statusCode})` : "Provider unavailable",
        httpStatus: error.statusCode ?? undefined,
      };
    case "EMPTY_RESPONSE":
      return { origin: "PROVIDER", code: "provider_empty_response", summary: "Provider returned an empty response" };
    case "INVALID_RESPONSE":
      return { origin: "PROVIDER", code: "provider_invalid_response", summary: "Provider returned an invalid response payload" };
    case "PROCESS_ERROR":
      return { origin: "HARNESS", code: "runner_environment_error", summary: "Local runner environment failed before the run completed" };
    case "CANCELLED":
      return { origin: "UNKNOWN", code: "cancelled", summary: "Run was cancelled before completion" };
    default:
      return {
        origin: error.origin === "NETWORK" ? "NETWORK" : "PROVIDER",
        code: error.origin === "NETWORK" ? "network_error" : "provider_error",
        summary: providerErrorSummary(error),
        httpStatus: error.statusCode ?? undefined,
      };
  }
}

function classifyModelFailure(bundle: VerdictInput["bundle"], evidence: VerdictEvidence, executionMode?: VerdictInput["executionMode"]): NormalizedVerdict {
  const integrityViolations = bundle.verification_results.integrity.violations;
  if (bundle.score.integrity_violations > 0 || integrityViolations.length > 0) {
    return fail("FAIL", "MODEL", "contract_violation", integrityViolations[0] ?? "Model output violated the task contract", evidence);
  }
  if (executionMode === "repo" && evidence.exitReason === "timeout") {
    return fail("FAIL", "MODEL", "execution_timeout", "Model run exhausted the execution time budget", { ...evidence, timeout: true });
  }
  if (executionMode === "repo" && evidence.exitReason === "budget_exceeded") {
    return fail("FAIL", "MODEL", "budget_exceeded", "Model run exhausted the step budget before completion", evidence);
  }
  if (bundle.diagnosis.failure_mode) {
    const failureMode = bundle.diagnosis.failure_mode.toLowerCase();
    if (failureMode.includes("malformed")) {
      return fail("FAIL", "MODEL", "model_output_malformed", bundle.diagnosis.failure_mode, evidence);
    }
    if (failureMode.includes("contract")) {
      return fail("FAIL", "MODEL", "contract_violation", bundle.diagnosis.failure_mode, evidence);
    }
    if (failureMode.includes("tool")) {
      return fail("FAIL", "MODEL", "invalid_tool_shape", bundle.diagnosis.failure_mode, evidence);
    }
    if (failureMode.includes("incomplete")) {
      return fail("FAIL", "MODEL", "incomplete_output", bundle.diagnosis.failure_mode, evidence);
    }
  }
  return fail("FAIL", "MODEL", "low_score", "Model completed the run but did not meet the pass threshold", evidence);
}

export function normalizeVerdict(input: VerdictInput): NormalizedVerdict {
  if (input.bundle.verdict) {
    return input.bundle.verdict;
  }

  const errorEvents = input.bundle.timeline.filter((event) => event.type === "error");
  const rawTimelineError = errorEvents
    .filter((event) => typeof event.detail === "string")
    .map((event) => event.detail!)
    .slice(-1)[0] ?? null;
  const timelineProviderError = errorEvents
    .map((event) => event.provider_error ?? null)
    .filter(Boolean)
    .slice(-1)[0] ?? null;
  const providerError = input.providerError ?? timelineProviderError;
  const rawError = input.rawError ?? providerError?.rawMessage ?? rawTimelineError;
  const evidence = baseEvidence({
    ...input,
    rawError,
    providerError,
  });

  const judgeOrTest = classifyJudgeOrTestFailure(input.bundle.verification_results, evidence);
  if (judgeOrTest) {
    return judgeOrTest;
  }

  if (input.exitReason === "injection_detected") {
    return fail("NC", "HARNESS", "harness_preflight_failure", "Run was blocked by harness security before completion", evidence);
  }

  if (providerError) {
    const structured = classifyStructuredProviderFailure(providerError);
    return fail("NC", structured.origin, structured.code, structured.summary, {
      ...evidence,
      rawError: rawError ?? providerError.rawMessage,
      providerError,
      httpStatus: structured.httpStatus ?? providerError.statusCode ?? null,
      timeout: !!structured.timeout || providerError.kind === "TIMEOUT",
    });
  }

  if (input.exitReason === "error" || rawError) {
    const transport = classifyLegacyTransportFailureText(rawError ?? "");
    if (transport) {
      return fail("NC", transport.origin, transport.code, transport.summary, {
        ...evidence,
        rawError,
        httpStatus: transport.httpStatus ?? null,
        timeout: !!transport.timeout,
      });
    }
    if (input.exitReason === "error") {
      return fail("NC", "UNKNOWN", "unknown_failure", "Run terminated before completion for an unknown non-model reason", {
        ...evidence,
        rawError,
      });
    }
  }

  if (input.bundle.score.pass) {
    return {
      ...PASS_VERDICT,
      evidence: {
        ...PASS_VERDICT.evidence,
        provider: input.bundle.agent.provider ?? null,
        adapter: input.bundle.agent.adapter ?? null,
        exitReason: input.exitReason ?? null,
        attemptCount: input.attemptCount ?? null,
        retries: input.retries ?? null,
      },
    };
  }

  return classifyModelFailure(input.bundle, {
    ...evidence,
    rawError,
  }, input.executionMode);
}

export function normalizeBundleVerdict(bundle: EvidenceBundle): NormalizedVerdict {
  return normalizeVerdict({
    bundle,
    executionMode: bundle.diff.files_changed.length || bundle.diff.files_created.length || bundle.diff.files_deleted.length ? "repo" : "conversational",
    exitReason: bundle.verdict?.evidence.exitReason ?? null,
    rawError: bundle.verdict?.evidence.rawError ?? null,
    providerError: bundle.verdict?.evidence.providerError ?? null,
    attemptCount: bundle.verdict?.evidence.attemptCount ?? null,
    retries: bundle.verdict?.evidence.retries ?? null,
  });
}

/**
 * After lane-specific evaluations have annotated the bundle, reconcile the
 * verdict with them. The benchmark/poison/build/safety/memory/personality
 * classifiers each emit `failure_is_infrastructure: true` for categories
 * that explicitly do NOT reflect model capability (EMPTY_RESPONSE, TIMEOUT,
 * PROVIDER_FAILURE, PARSER_FAILURE, RUBRIC_MISMATCH, PREFLIGHT_BLOCKED).
 *
 * If any of those fire while the verdict still says the model failed,
 * downgrade the verdict to NC. Without this step, the leaderboard
 * (`leaderboard/aggregator.ts`) reads `countsTowardModelScore: true` from
 * the verdict and includes the run in the model's composite, even though
 * the per-lane evaluation explicitly says the failure was infrastructure.
 *
 * The function is intentionally a no-op when the verdict already says PASS
 * or NC, or when the failure origin isn't MODEL — in those cases the verdict
 * layer already agrees with the lane evaluations and nothing needs to move.
 */
export function reconcileVerdictWithLaneEvaluations(bundle: EvidenceBundle): void {
  if (!bundle.verdict) return;
  if (bundle.verdict.completionState !== "FAIL") return;
  if (bundle.verdict.failureOrigin !== "MODEL") return;

  const evaluations: Array<{ field: string; category: string }> = [];
  const fields = [
    "benchmark_evaluation",
    "poison_evaluation",
    "build_evaluation",
    "safety_evaluation",
    "memory_evaluation",
    "personality_evaluation",
  ] as const;
  for (const field of fields) {
    const evalObj = (bundle as unknown as Record<string, unknown>)[field] as
      | { category: string; failure_is_infrastructure: boolean }
      | undefined;
    if (evalObj && evalObj.failure_is_infrastructure === true) {
      evaluations.push({ field, category: evalObj.category });
    }
  }
  if (evaluations.length === 0) return;

  const primary = evaluations[0]!;
  const origin: FailureOrigin =
    primary.category === "RUBRIC_MISMATCH" ? "JUDGE" :
    primary.category === "PREFLIGHT_BLOCKED" ? "HARNESS" :
    primary.category === "PARSER_FAILURE" ? "PROVIDER" :
    primary.category === "EMPTY_RESPONSE" ? "PROVIDER" :
    primary.category === "TIMEOUT" ? "PROVIDER" :
    primary.category === "PROVIDER_FAILURE" ? "PROVIDER" :
    "UNKNOWN";

  const code: FailureReasonCode =
    primary.category === "RUBRIC_MISMATCH" ? "judge_not_evaluable" :
    primary.category === "EMPTY_RESPONSE" ? "provider_empty_response" :
    primary.category === "TIMEOUT" ? "provider_timeout" :
    primary.category === "PROVIDER_FAILURE" ? "provider_error" :
    primary.category === "PARSER_FAILURE" ? "provider_invalid_response" :
    primary.category === "PREFLIGHT_BLOCKED" ? "harness_preflight_failure" :
    "unknown_failure";

  bundle.verdict = {
    completionState: "NC",
    failureOrigin: origin,
    failureReasonCode: code,
    failureReasonSummary: `Reconciled from lane evaluation ${primary.field}=${primary.category} (failure_is_infrastructure)`,
    countsTowardModelScore: false,
    countsTowardFailureRate: false,
    evidence: bundle.verdict.evidence,
  };

  // The lane evaluation's score_basis captured the pre-reconciliation verdict
  // string ("verdict=FAIL:MODEL:..."). After we downgrade to NC, append the
  // reconciled verdict so a drilldown consumer reading score_basis sees the
  // same story bundle.verdict now tells.
  const reconciledMarker = `reconciled_verdict=NC:${origin}:${code}`;
  for (const field of fields) {
    const evalObj = (bundle as unknown as Record<string, unknown>)[field] as
      | { score_basis: string[] }
      | undefined;
    if (evalObj && Array.isArray(evalObj.score_basis) && !evalObj.score_basis.includes(reconciledMarker)) {
      evalObj.score_basis.push(reconciledMarker);
    }
  }
}
