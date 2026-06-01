/**
 * Luak — auditable failure evidence for experimental benchmark runs.
 *
 * When an experimental cell fails we need to be able to answer *why* after the
 * fact: did the model actually produce unsafe/incorrect content, or did a
 * deterministic scorer reject a semantically-valid answer? The cost receipt and
 * the summary cell alone (failureOrigin/failureCode/score) can't distinguish
 * those, so this module projects a bundle onto:
 *
 *   - a small {@link FailureEvidence} block (safe to embed in the JSON report
 *     and receipt), and
 *   - an optional {@link RedactedTranscript} artifact (the per-turn prompts,
 *     responses, and judge reasons), written alongside the report.
 *
 * EVERY string that leaves this module is run through {@link redactSecrets}
 * first. The raw provider error object, request headers, and env values are
 * never copied here — only the sanitized model-facing transcript and the
 * deterministic judge's reason.
 */

import { redactSecrets } from "./redact.js";

/**
 * Structural, read-only view of the bundle fields this module consumes. Kept
 * deliberately loose (deep-optional) so it accepts both a full `EvidenceBundle`
 * and the minimal shapes used in tests — we only ever read these fields.
 */
export interface ConversationalTurnLike {
  question_id?: string | null;
  question?: string | null;
  response?: string | null;
  passed?: boolean;
  score?: number | null;
  failure_reason?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
}

export interface EvidenceBundleLike {
  bundle_id?: string | null;
  score?: { total?: number | null } | null;
  diagnosis?: { failure_mode?: string | null } | null;
  conversational?: { results?: ReadonlyArray<ConversationalTurnLike> } | null;
}

/** Excerpt budget for the in-report evidence block. */
const REPORT_EXCERPT_MAX = 600;
/** Per-field budget inside the (larger, but still bounded) transcript artifact. */
const TRANSCRIPT_FIELD_MAX = 4000;

export interface FailureEvidence {
  taskId: string;
  model: string;
  bundleId: string | null;
  failureOrigin: string | null;
  failureCode: string | null;
  /** Overall task score in [0,1] when the bundle scored, else null. */
  score: number | null;
  /** The first failing turn/question id (e.g. "S1-Q2"), when known. */
  failedTurnId: string | null;
  /** Redacted excerpt of the failing prompt/question. */
  promptExcerpt: string | null;
  /** Redacted excerpt of the (sanitized) model response. */
  responseExcerpt: string | null;
  /** Redacted deterministic judge/scorer reason. */
  judgeReason: string | null;
  /** Path (relative to the report dir) of the transcript artifact, if written. */
  transcriptPath: string | null;
  /** Path of a separate bundle artifact, if one is written (none today). */
  bundlePath: string | null;
}

export interface RedactedTranscriptTurn {
  turnId: string | null;
  passed: boolean;
  score: number | null;
  prompt: string;
  response: string;
  judgeReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface RedactedTranscript {
  schema: "luak.experimental-transcript.v1";
  taskId: string;
  model: string;
  bundleId: string | null;
  executionMode: "conversational" | "repo" | "unknown";
  turns: RedactedTranscriptTurn[];
  note: string;
}

export interface FailureEvidenceContext {
  taskId: string;
  model: string;
  failureOrigin: string | null;
  failureCode: string | null;
  /** Already-redacted safe provider message, used as a last-resort judgeReason. */
  providerMessage?: string | null;
}

/** Redact, then bound the length of an arbitrary value for display/storage. */
function excerpt(value: unknown, max: number): string {
  const redacted = redactSecrets(value);
  if (redacted.length <= max) return redacted;
  return redacted.slice(0, max) + "…";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build the failure-evidence block + an optional redacted transcript from a
 * failed bundle. Returns `null` evidence only when given no bundle at all.
 */
export function extractFailureEvidence(
  bundle: EvidenceBundleLike | null | undefined,
  ctx: FailureEvidenceContext,
): { evidence: FailureEvidence; transcript: RedactedTranscript | null } {
  const bundleId = bundle?.bundle_id ?? null;
  const score = numberOrNull(bundle?.score?.total);
  const results = bundle?.conversational?.results;

  let failedTurnId: string | null = null;
  let promptExcerpt: string | null = null;
  let responseExcerpt: string | null = null;
  let judgeReason: string | null = null;
  let transcript: RedactedTranscript | null = null;
  let executionMode: RedactedTranscript["executionMode"] = "unknown";

  if (Array.isArray(results) && results.length > 0) {
    executionMode = "conversational";
    // The failing turn is the audit target; fall back to the last turn so the
    // block is never empty even on an all-pass-but-low-aggregate edge case.
    const failed = results.find((r) => r.passed === false);
    const ref = failed ?? results[results.length - 1];
    failedTurnId = ref?.question_id ?? null;
    promptExcerpt = excerpt(ref?.question ?? "", REPORT_EXCERPT_MAX);
    responseExcerpt = excerpt(ref?.response ?? "", REPORT_EXCERPT_MAX);
    judgeReason = ref?.failure_reason != null ? excerpt(ref.failure_reason, REPORT_EXCERPT_MAX) : null;

    transcript = {
      schema: "luak.experimental-transcript.v1",
      taskId: ctx.taskId,
      model: ctx.model,
      bundleId,
      executionMode,
      turns: results.map((r) => ({
        turnId: r.question_id ?? null,
        passed: r.passed === true,
        score: numberOrNull(r.score),
        // `response` is the post-sanitization text the judge actually saw —
        // visible chain-of-thought already stripped — then secret-redacted.
        prompt: excerpt(r.question ?? "", TRANSCRIPT_FIELD_MAX),
        response: excerpt(r.response ?? "", TRANSCRIPT_FIELD_MAX),
        judgeReason: r.failure_reason != null ? excerpt(r.failure_reason, TRANSCRIPT_FIELD_MAX) : null,
        tokensIn: numberOrNull(r.tokens_in),
        tokensOut: numberOrNull(r.tokens_out),
      })),
      note:
        "Redacted experimental transcript. Responses are post-sanitization (visible " +
        "reasoning stripped) and secret-redacted. Not a full evidence bundle.",
    };
  } else {
    // No turn-level outputs (repo task, or a pre-execution / provider failure).
    // Capture the safe failure_mode and provider message — never raw errors.
    const failureMode = bundle?.diagnosis?.failure_mode ?? null;
    judgeReason = failureMode
      ? excerpt(failureMode, REPORT_EXCERPT_MAX)
      : ctx.providerMessage
        ? excerpt(ctx.providerMessage, REPORT_EXCERPT_MAX)
        : null;
    executionMode = bundle?.conversational ? "conversational" : "repo";
    transcript = {
      schema: "luak.experimental-transcript.v1",
      taskId: ctx.taskId,
      model: ctx.model,
      bundleId,
      executionMode,
      turns: [],
      note:
        "No turn-level model outputs were available for this cell (repo-mode or " +
        "provider failure). See failureCode / judgeReason for the cause.",
    };
  }

  const evidence: FailureEvidence = {
    taskId: ctx.taskId,
    model: ctx.model,
    bundleId,
    failureOrigin: ctx.failureOrigin ? redactSecrets(ctx.failureOrigin) : null,
    failureCode: ctx.failureCode ? redactSecrets(ctx.failureCode) : null,
    score,
    failedTurnId,
    promptExcerpt,
    responseExcerpt,
    judgeReason,
    transcriptPath: null,
    bundlePath: null,
  };

  return { evidence, transcript };
}
