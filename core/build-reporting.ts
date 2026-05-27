import type { EvidenceBundle, ExecutionResult } from "../adapters/base.js";
import type { JudgeCommandResult } from "./verdict.js";
import type { NormalizedVerdict } from "../types/verdict.js";

export type BuildEvaluation = NonNullable<EvidenceBundle["build_evaluation"]>;

function isBuildBundle(bundle: EvidenceBundle): boolean {
  return bundle.task.family === "orchestration";
}

function commandResults(bundle: EvidenceBundle): JudgeCommandResult[] {
  return [
    ...(bundle.verification_results.correctness.command_results ?? []),
    ...(bundle.verification_results.regression.command_results ?? []),
  ];
}

function timelineError(bundle: EvidenceBundle): string | null {
  return bundle.timeline
    .filter((event) => event.type === "error" && typeof event.detail === "string")
    .map((event) => event.detail!)
    .slice(-1)[0] ?? null;
}

function rawReason(bundle: EvidenceBundle, verdict: NormalizedVerdict): string {
  return verdict.evidence.rawError
    ?? verdict.evidence.judgeError
    ?? verdict.evidence.testError
    ?? timelineError(bundle)
    ?? verdict.failureReasonSummary
    ?? commandResults(bundle).find((result) => result.status !== "pass")?.summary
    ?? "No additional reason recorded";
}

function scoreBasis(bundle: EvidenceBundle, verdict: NormalizedVerdict): string[] {
  const items = [
    `family=${bundle.task.family}`,
    `task=${bundle.task.id}`,
    `provider=${bundle.agent.provider}`,
    `model=${bundle.agent.model}`,
    `verdict=${verdict.completionState}:${verdict.failureOrigin ?? "NONE"}:${verdict.failureReasonCode}`,
    `composite_score=${bundle.score.total_percent}%`,
    `correctness=${bundle.score.breakdown_percent.correctness}%`,
    `regression=${bundle.score.breakdown_percent.regression}%`,
    `integrity=${bundle.score.breakdown_percent.integrity}%`,
    `efficiency=${bundle.score.breakdown_percent.efficiency}%`,
    `pass_threshold=${bundle.score.pass_threshold_percent}%`,
    `files_changed=${bundle.diff.files_changed.length}`,
  ];

  for (const result of commandResults(bundle).slice(0, 6)) {
    const exit = result.exitCode == null ? "null" : String(result.exitCode);
    items.push(`${result.scope}:${result.id}:${result.status}:exit=${exit}:cmd=${result.command}`);
    if (result.summary) items.push(`${result.scope}:${result.id}:summary=${result.summary}`);
  }
  for (const violation of bundle.verification_results.integrity.violations.slice(0, 4)) {
    items.push(`integrity_violation=${violation}`);
  }
  if (bundle.diagnosis.failure_mode) items.push(`diagnosis=${bundle.diagnosis.failure_mode}`);
  return items;
}

function commandText(results: JudgeCommandResult[]): string {
  return results.map((result) => `${result.id}\n${result.command}\n${result.summary}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`).join("\n").toLowerCase();
}

function hasNoEdit(bundle: EvidenceBundle): boolean {
  return bundle.diff.files_changed.length === 0
    && bundle.diff.files_created.length === 0
    && bundle.diff.files_deleted.length === 0;
}

function hasSandboxFailure(bundle: EvidenceBundle, verdict: NormalizedVerdict): boolean {
  const text = [
    verdict.failureReasonSummary,
    verdict.evidence.rawError,
    timelineError(bundle),
    ...commandResults(bundle).map((result) => `${result.errorKind ?? ""} ${result.summary}`),
  ].join("\n").toLowerCase();
  return /\bspawn_error\b|command could not start|enoent|eacces|sandbox|workspace|path escape|runner_environment_error/.test(text);
}

function rubricOrParserCategory(bundle: EvidenceBundle, verdict: NormalizedVerdict): BuildEvaluation["category"] | null {
  const text = [
    verdict.failureReasonSummary,
    bundle.diagnosis.failure_mode,
    ...commandResults(bundle).map((result) => `${result.errorKind ?? ""} ${result.summary}`),
  ].join("\n").toLowerCase();

  if (/model_output_malformed|provider_invalid_response|invalid json|parser/.test(text)) return "PARSER_FAILURE";
  // Bare token /rubric/ was matching innocuous mentions like
  // "rubric-based judging". Require a phrase that names a rubric *bug*.
  if (/not evaluable|unsupported|no command|oracle.*missing|rubric mismatch|rubric not evaluable|correctness checks were not evaluable/.test(text)) return "RUBRIC_MISMATCH";
  return null;
}

function commandFailureCategory(bundle: EvidenceBundle): BuildEvaluation["category"] | null {
  const failed = commandResults(bundle).filter((result) => result.status !== "pass");
  if (failed.length === 0) return null;
  const text = commandText(failed);

  if (/pre[- ]?agent|baseline|preexisting repo failure|pre-existing repo failure/.test(text)) {
    return "PREEXISTING_REPO_FAILURE";
  }
  if (/\b(build|tsc|vite|webpack|rollup|esbuild|npm run build|pnpm build|yarn build)\b/.test(text)) {
    return "BUILD_FAILED";
  }
  return "TEST_FAILED";
}

function completedModelCategory(bundle: EvidenceBundle): BuildEvaluation["category"] {
  // Caller (classifyBuildEvaluation) already early-returns PASS on
  // verdict.completionState === "PASS", so a passing bundle never reaches
  // this function. The branch is here for safety in case a caller invokes
  // it directly without the verdict gate; kept intentionally trivial.
  if (bundle.score.pass) return "PASS";
  if (hasNoEdit(bundle)) return "NO_EDIT";
  if (bundle.verification_results.integrity.violations.length > 0) return "WRONG_EDIT";

  const diagnosis = (bundle.diagnosis.failure_mode ?? "").toLowerCase();
  if (/wrong_fix|localization_failure|partial_localization|decoy_distraction|contract_violation/.test(diagnosis)) {
    return "WRONG_EDIT";
  }

  const commandCategory = commandFailureCategory(bundle);
  if (commandCategory) return commandCategory;

  if (bundle.score.total > 0 && bundle.score.total < bundle.score.pass_threshold) return "PARTIAL";
  return "UNKNOWN";
}

export function classifyBuildEvaluation(
  bundle: EvidenceBundle,
  verdict: NormalizedVerdict,
  execution?: Pick<ExecutionResult, "exit_reason"> | undefined,
): BuildEvaluation | undefined {
  if (!isBuildBundle(bundle)) return undefined;

  const basis = scoreBasis(bundle, verdict);
  const reason = rawReason(bundle, verdict);

  if (verdict.completionState === "PASS") {
    return {
      category: "PASS",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: "Build lane met the pass threshold using deterministic repo verification",
    };
  }

  if (verdict.failureReasonCode === "provider_empty_response") {
    return {
      category: "EMPTY_RESPONSE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureReasonCode === "provider_timeout" || verdict.failureReasonCode === "execution_timeout" || execution?.exit_reason === "timeout") {
    return {
      category: "TIMEOUT",
      score_basis: basis,
      reflects_model_capability: verdict.failureOrigin === "MODEL",
      failure_is_infrastructure: verdict.failureOrigin !== "MODEL",
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureOrigin === "PROVIDER" || verdict.failureOrigin === "NETWORK") {
    return {
      category: "PROVIDER_FAILURE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (hasSandboxFailure(bundle, verdict)) {
    return {
      category: "SANDBOX_FAILURE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  const rubricCategory = rubricOrParserCategory(bundle, verdict);
  if (rubricCategory) {
    return {
      category: rubricCategory,
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (commandFailureCategory(bundle) === "PREEXISTING_REPO_FAILURE") {
    return {
      category: "PREEXISTING_REPO_FAILURE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureOrigin === "JUDGE" || verdict.failureOrigin === "TEST") {
    return {
      category: commandFailureCategory(bundle) ?? "RUBRIC_MISMATCH",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.completionState === "FAIL") {
    return {
      category: completedModelCategory(bundle),
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: reason,
    };
  }

  return {
    category: "UNKNOWN",
    score_basis: basis,
    reflects_model_capability: verdict.countsTowardModelScore,
    failure_is_infrastructure: verdict.completionState === "NC",
    raw_or_summary_reason: reason,
  };
}
