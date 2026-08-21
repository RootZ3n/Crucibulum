/**
 * Luak — local-model failure taxonomy (v1).
 *
 * Hosted models fail in a narrow band: they answer, they refuse, or the
 * provider returns an HTTP error. Local models fail in far more ways, and most
 * of those ways are invisible to the existing vocabulary. A model that loaded
 * onto the CPU because a kernel module was late, a model whose chat template
 * does not match the one the server applied, a model that decoded fluent JSON
 * with an unclosed brace at 8K context — all three currently land in the same
 * bucket as "wrong answer", and none of them is one.
 *
 * This file adds the missing distinctions **without redefining any existing
 * one**. `CompletionState`, `FailureOrigin` and `FailureReasonCode` keep their
 * exact meanings; every local code maps onto them, and historical evidence is
 * read with the semantics it was written under.
 *
 * The organising principle is attribution. A benchmark that cannot say whose
 * fault a failure was cannot qualify anything: it produces a number that is
 * part model, part runtime, part harness, and reports it as a model score.
 */
import type { CompletionState, FailureOrigin, FailureReasonCode } from "./verdict.js";

/** Bump when a code is added, removed, or its meaning changes. Evidence is bound to this. */
export const LOCAL_TAXONOMY_VERSION = "local-failure-taxonomy-1.1.0" as const;
export type LocalTaxonomyVersion = typeof LOCAL_TAXONOMY_VERSION;

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Who or what a result is actually about.
 *
 * This is the axis the existing scoreboard lacks, and its absence is why
 * `tool_calling` scores read as model capability when they are really the
 * product of a model and a regex. A measurement that cannot be placed on this
 * axis is not admissible as qualification evidence.
 */
export type AttributionClass =
  /** The model produced this, given a working runtime and a faithful harness. */
  | "MODEL"
  /** The inference runtime or hosting provider: crash, OOM, device placement, capacity. */
  | "RUNTIME_PROVIDER"
  /** Luak's own parsing, prompting, or judging — including free-text command extraction. */
  | "HARNESS_PARSER"
  /** The tool sandbox: filesystem, shell, workspace, network policy. */
  | "TOOL_SANDBOX"
  /**
   * Two or more of the above, inseparably.
   *
   * Not a failure of classification but an honest verdict about a measurement
   * design. A composite result may be reported and compared; it may never be
   * exported as a model-only score.
   */
  | "COMPOSITE";

export const ATTRIBUTION_CLASSES: readonly AttributionClass[] = [
  "MODEL",
  "RUNTIME_PROVIDER",
  "HARNESS_PARSER",
  "TOOL_SANDBOX",
  "COMPOSITE",
];

/** Only MODEL-attributed results may contribute to a model capability claim. */
export function isModelAttributable(a: AttributionClass): boolean {
  return a === "MODEL";
}

// ---------------------------------------------------------------------------
// Applicability
// ---------------------------------------------------------------------------

/**
 * Why a lane produced no score.
 *
 * A model that cannot accept images did not *fail* the vision lane, and a
 * chat-only endpoint did not *fail* the agentic repo lane. Scoring either as
 * zero would manufacture a deficiency out of an interface mismatch — which is
 * precisely the error the existing skip classifiers were added to prevent, now
 * given first-class names in the local lane.
 */
export type LocalApplicability =
  /** The lane ran and produced a measurement. */
  | "APPLICABLE"
  /** The lane does not apply to this interface at all. Not a failure. */
  | "NOT_APPLICABLE"
  /** The model or runtime lacks a capability the lane requires. Not a failure. */
  | "UNSUPPORTED_CAPABILITY";

// ---------------------------------------------------------------------------
// Local failure codes
// ---------------------------------------------------------------------------

/**
 * Failure modes specific to running a model locally.
 *
 * Every code below carries a mapping to the existing vocabulary (see
 * LOCAL_FAILURE_MAP). Where an existing `FailureReasonCode` already means
 * exactly the right thing, it is reused and no new code is added — the reuse
 * column in that table is the evidence for that claim, not a promise about it.
 */
export type LocalFailureCode =
  // ── model behaviour ──────────────────────────────────────────────────────
  /** Answered, and the answer is wrong. The ordinary case. */
  | "local_wrong_answer"
  /** Ignored an explicit instruction (format, length, "only output X"). */
  | "local_instruction_not_followed"
  /** Output was not valid against the declared schema — malformed JSON, missing fields. */
  | "local_invalid_structured_output"
  /** Cited something that is not in the supplied evidence, or cited nothing. */
  | "local_citation_unsupported"
  /** Asserted a fact absent from the evidence. Distinct from citing badly. */
  | "local_hallucinated_fact"
  /** Refused or abstained when the evidence was sufficient to answer. */
  | "local_invalid_refusal"
  /** Correctly declined because the evidence did not support an answer. Not a failure. */
  | "local_valid_abstention"
  /** Produced degenerate output: loops, repeated n-grams, runaway punctuation. */
  | "local_degeneration_repetition"
  /** Stopped mid-structure — truncated JSON, unterminated string, cut-off sentence. */
  | "local_truncated_completion"
  /** Returned nothing, or only whitespace. */
  | "local_empty_completion"
  /** Followed instructions embedded in the evidence instead of treating them as data. */
  | "local_injection_followed"

  // ── context ──────────────────────────────────────────────────────────────
  /** Input exceeded the served context. A configuration fact, not a model failure. */
  | "local_context_overflow"
  /**
   * Fit inside the window and degraded anyway — the fact was present and was
   * missed. This is the measurement long-context tiers exist to produce, and
   * it is meaningless without knowing the fact's position.
   */
  | "local_context_degraded"

  // ── runtime ──────────────────────────────────────────────────────────────
  /** Timed out while loading weights. */
  | "local_timeout_load"
  /** Timed out during prompt processing. */
  | "local_timeout_prefill"
  /** Timed out during generation. */
  | "local_timeout_decode"
  /** The inference process died. */
  | "local_runtime_crash"
  /** Out of memory — host RAM or device VRAM. */
  | "local_resource_exhausted"
  /**
   * Ran on the CPU when the GPU was expected, or otherwise not where intended.
   * Serves the right artifact, attests correctly, and runs at a fraction of the
   * rate — invisible to every check that does not look for it.
   */
  | "local_unintended_device_placement"
  /** The runtime served a different artifact than the one under test. */
  | "local_wrong_served_artifact"
  /** Chat template or tokenizer disagreed with what the evidence assumes. */
  | "local_prompt_template_mismatch"
  /** The server refused for capacity reasons: queue full, slots busy, lease held. */
  | "local_capacity_refused"
  /**
   * The runtime did not deliver a guarantee it accepted.
   *
   * Added in 1.1.0 for the constrained regime, where it is the only honest
   * verdict available. Under `json_schema` the runtime accepted a schema and
   * undertook to constrain generation to it; output that does not conform means
   * that undertaking was not kept. Scoring it against the model would be
   * exactly backwards — the model had no say in the matter — and scoring it as
   * a model *success* would be worse. It is the runtime's, and it is not a
   * capability measurement of anything.
   */
  | "local_runtime_contract_violation"

  // ── harness ──────────────────────────────────────────────────────────────
  /** Luak could not parse the response into a scoreable shape. */
  | "local_harness_parse_failure"
  /** The scorer or oracle itself failed. */
  | "local_harness_judge_failure"
  /**
   * The model emitted something, and the harness's free-text extractor did not
   * recognise it. Deliberately distinct from invalid structured output: one is
   * the model's fault, the other may be the extractor's, and a benchmark that
   * cannot tell them apart cannot certify tool use.
   */
  | "local_harness_extraction_failure";

export const LOCAL_FAILURE_CODES: readonly LocalFailureCode[] = [
  "local_wrong_answer",
  "local_instruction_not_followed",
  "local_invalid_structured_output",
  "local_citation_unsupported",
  "local_hallucinated_fact",
  "local_invalid_refusal",
  "local_valid_abstention",
  "local_degeneration_repetition",
  "local_truncated_completion",
  "local_empty_completion",
  "local_injection_followed",
  "local_context_overflow",
  "local_context_degraded",
  "local_timeout_load",
  "local_timeout_prefill",
  "local_timeout_decode",
  "local_runtime_crash",
  "local_resource_exhausted",
  "local_unintended_device_placement",
  "local_wrong_served_artifact",
  "local_prompt_template_mismatch",
  "local_capacity_refused",
  "local_runtime_contract_violation",
  "local_harness_parse_failure",
  "local_harness_judge_failure",
  "local_harness_extraction_failure",
];

// ---------------------------------------------------------------------------
// Mapping onto the existing vocabulary
// ---------------------------------------------------------------------------

export interface LocalFailureMapping {
  /** Existing completion state. Unchanged semantics. */
  readonly completionState: CompletionState;
  /** Existing origin. Unchanged semantics. */
  readonly failureOrigin: FailureOrigin | null;
  /**
   * The existing reason code this collapses to for legacy consumers. Where an
   * existing code already means exactly this, `reusesExisting` is true and no
   * new meaning has been invented.
   */
  readonly legacyReasonCode: FailureReasonCode;
  readonly reusesExisting: boolean;
  readonly attribution: AttributionClass;
  /**
   * Whether this outcome may count against the model's capability score.
   * Infrastructure failures are counted and reported — they are never silently
   * dropped — but they do not lower a model's measured capability unless the
   * scoring regime says so explicitly.
   */
  readonly countsTowardModelScore: boolean;
  readonly why: string;
}

/**
 * The whole taxonomy in one table, so the mapping can be read and audited in
 * one place rather than inferred from scattered switch statements.
 */
export const LOCAL_FAILURE_MAP: Readonly<Record<LocalFailureCode, LocalFailureMapping>> =
  Object.freeze({
    local_wrong_answer: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "wrong_output",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "The existing wrong_output means exactly this.",
    },
    local_instruction_not_followed: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "contract_violation",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "contract_violation already covers 'did not do what the prompt required'.",
    },
    local_invalid_structured_output: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "model_output_malformed",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "model_output_malformed is the exact existing meaning.",
    },
    local_citation_unsupported: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "wrong_output",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New. No existing code distinguishes 'right-looking answer, ungrounded citation' " +
        "from a plainly wrong answer, and for grounded tasks that distinction is the point.",
    },
    local_hallucinated_fact: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "wrong_output",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New. Asserting an absent fact is scored separately from citing a real fact badly; " +
        "quantisation damage shows up here first.",
    },
    local_invalid_refusal: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "incomplete_output",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New. Over-refusal is a distinct defect from an incomplete answer and must not be " +
        "rewarded as caution.",
    },
    local_valid_abstention: {
      completionState: "PASS", failureOrigin: null, legacyReasonCode: "pass",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "Declining when the evidence does not support an answer is a correct outcome, " +
        "and the taxonomy has to be able to say so or abstention can never be scored.",
    },
    local_degeneration_repetition: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "model_output_malformed",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New. Looping is a characteristic low-bit-quantisation failure and is invisible if " +
        "folded into 'malformed'.",
    },
    local_truncated_completion: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "incomplete_output",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "incomplete_output already means this.",
    },
    local_empty_completion: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "provider_empty_response",
      reusesExisting: true, attribution: "MODEL", countsTowardModelScore: true,
      why: "Reuses the existing empty-response code. Attribution is MODEL rather than PROVIDER " +
        "when the runtime returned a well-formed response containing nothing.",
    },
    local_injection_followed: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "contract_violation",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New. Obeying instructions embedded in evidence is a security-relevant failure that " +
        "no existing code names, and it must be visible on its own.",
    },
    local_context_overflow: {
      completionState: "NC", failureOrigin: "HARNESS", legacyReasonCode: "budget_exceeded",
      reusesExisting: true, attribution: "HARNESS_PARSER", countsTowardModelScore: false,
      why: "Sending more than the served context is a harness configuration error. The model " +
        "was never given a fair chance, so this cannot count against it.",
    },
    local_context_degraded: {
      completionState: "FAIL", failureOrigin: "MODEL", legacyReasonCode: "wrong_output",
      reusesExisting: false, attribution: "MODEL", countsTowardModelScore: true,
      why: "New, and the whole reason for long-context tiers: the fact fit in the window and " +
        "was still missed. Meaningless without the position metadata the generator records.",
    },
    local_timeout_load: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_timeout",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "Weight loading is runtime work. Split from prefill/decode because the operator fix " +
        "differs — disk and memory, not sampling.",
    },
    local_timeout_prefill: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_timeout",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "Prompt processing timed out; typically a context-size or batch problem.",
    },
    local_timeout_decode: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_timeout",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "Generation timed out. Usually throughput, sometimes degeneration — which is why " +
        "degeneration has its own code rather than hiding here.",
    },
    local_runtime_crash: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_process_error",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "provider_process_error already means the process died.",
    },
    local_resource_exhausted: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_process_error",
      reusesExisting: false, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "New. OOM is separated from a generic process error because it is the failure a " +
        "context-tier campaign is most likely to hit, and the operator response is specific.",
    },
    local_unintended_device_placement: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "runner_environment_error",
      reusesExisting: false, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "New. A CPU-only fallback serves the correct artifact and attests correctly at a " +
        "fraction of the rate. Without this code the measurement looks valid and is not.",
    },
    local_wrong_served_artifact: {
      completionState: "NC", failureOrigin: "HARNESS", legacyReasonCode: "harness_preflight_failure",
      reusesExisting: false, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "New. Evidence produced against the wrong artifact is not evidence about this one; " +
        "it must be voided rather than scored.",
    },
    local_prompt_template_mismatch: {
      completionState: "NC", failureOrigin: "HARNESS", legacyReasonCode: "harness_preflight_failure",
      reusesExisting: false, attribution: "COMPOSITE", countsTowardModelScore: false,
      why: "New, and deliberately COMPOSITE: a template mismatch degrades output in a way that " +
        "looks exactly like model incapacity, and neither side can be isolated after the fact.",
    },
    local_capacity_refused: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_unavailable",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "A typed capacity refusal is the server declining to start work, not the model failing.",
    },
    local_runtime_contract_violation: {
      completionState: "NC", failureOrigin: "PROVIDER", legacyReasonCode: "provider_error",
      reusesExisting: true, attribution: "RUNTIME_PROVIDER", countsTowardModelScore: false,
      why: "The runtime accepted a constraint and did not apply it. provider_error already " +
        "means the provider failed to do what it undertook; the model is not a party to it, " +
        "and the attempt is neither a capability success nor a capability failure.",
    },
    local_harness_parse_failure: {
      completionState: "NC", failureOrigin: "HARNESS", legacyReasonCode: "harness_runtime_failure",
      reusesExisting: true, attribution: "HARNESS_PARSER", countsTowardModelScore: false,
      why: "harness_runtime_failure already means Luak broke.",
    },
    local_harness_judge_failure: {
      completionState: "NC", failureOrigin: "JUDGE", legacyReasonCode: "judge_failure",
      reusesExisting: true, attribution: "HARNESS_PARSER", countsTowardModelScore: false,
      why: "judge_failure already means the scorer broke.",
    },
    local_harness_extraction_failure: {
      completionState: "NC", failureOrigin: "HARNESS", legacyReasonCode: "harness_runtime_failure",
      reusesExisting: false, attribution: "COMPOSITE", countsTowardModelScore: false,
      why: "New, and the most consequential addition. 'The model emitted something and our " +
        "extractor did not recognise it' is not the same as 'the model cannot use tools'. " +
        "Scored as COMPOSITE so it can never be exported as a model-only result.",
    },
  });

/** Codes added by this taxonomy rather than reused. Asserted by test, not by claim. */
export function newlyAddedCodes(): readonly LocalFailureCode[] {
  return LOCAL_FAILURE_CODES.filter((c) => !LOCAL_FAILURE_MAP[c].reusesExisting);
}

/** Project a local code onto the pre-existing vocabulary, losing the local detail. */
export function toLegacyVerdict(code: LocalFailureCode): {
  completionState: CompletionState;
  failureOrigin: FailureOrigin | null;
  failureReasonCode: FailureReasonCode;
  countsTowardModelScore: boolean;
  countsTowardFailureRate: boolean;
} {
  const m = LOCAL_FAILURE_MAP[code];
  return {
    completionState: m.completionState,
    failureOrigin: m.failureOrigin,
    failureReasonCode: m.legacyReasonCode,
    // Preserves the existing rule exactly: NC never counts toward the model
    // score, and only a MODEL-origin FAIL counts toward the failure rate.
    countsTowardModelScore: m.completionState !== "NC",
    countsTowardFailureRate: m.completionState === "FAIL" && m.failureOrigin === "MODEL",
  };
}

/** One scored local attempt, as the local lanes record it. */
export interface LocalAttemptVerdict {
  readonly taxonomyVersion: LocalTaxonomyVersion;
  readonly applicability: LocalApplicability;
  /** Null when applicability is not APPLICABLE — nothing was measured. */
  readonly code: LocalFailureCode | null;
  readonly attribution: AttributionClass;
  readonly detail: string;
}

/**
 * How a token count was obtained.
 *
 * Lives here, not beside the regime, because two places needed it — the attempt
 * records and the identity the evidence is bound to — and when they each kept
 * their own copy the copies drifted: the identity's was three-valued and could
 * not express `runtime_reported_unknown_tokenizer` at all, so an identity for a
 * run that measured exactly that had to round itself down to `unknown`. One
 * definition, imported by both.
 *
 *   runtime_tokenizer                  The serving runtime counted, and said so.
 *   runtime_reported_unknown_tokenizer The runtime returned counts but named no
 *                                      tokenizer. Probably exact; "probably" is
 *                                      not provenance.
 *   estimated                          Computed client-side.
 *   unknown                            No count at all.
 */
export type TokenCountSource =
  | "runtime_tokenizer"
  | "runtime_reported_unknown_tokenizer"
  | "estimated"
  | "unknown";

/** The only provenance a qualification export accepts. */
export const EXPORTABLE_TOKEN_SOURCES: readonly TokenCountSource[] = ["runtime_tokenizer"];
