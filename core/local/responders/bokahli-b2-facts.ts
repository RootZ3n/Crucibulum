/**
 * Luak — reading Bokahli's B2 attestation without overstating it.
 *
 * Bokahli's contract is careful about the difference between what a backend
 * *holds*, what an uncorrelated reading *shows*, and what was *confirmed for
 * this request*. That care is worth nothing if the consumer flattens it on
 * arrival, so this module keeps the tiers apart and refuses to invent the ones
 * Bokahli does not publish.
 *
 * Three rules govern everything below:
 *
 *   - A configured fact is never recorded as a request-confirmed one. Bokahli's
 *     `requestConfirmed` is null on this build because llama.cpp's chat
 *     response carries no slot or task id, and Luak has no extra information
 *     that would let it fill that in.
 *   - A weaker binding is never relabelled as a stronger one. A
 *     `configured-tree` image digest proves what was on disk, not what the
 *     process mapped, and it stays labelled that way in the evidence.
 *   - Absent is not false. Every field that could not be read is null, and a
 *     null is recorded as a null rather than as a negative finding — a Phase 1
 *     response that predates these fields must not look like a deployment that
 *     failed them.
 */

/** Template identity, kept in the four tiers Bokahli publishes. */
export interface BokahliTemplateFacts {
  /** Digest of the template inside the verified artifact, per Bokahli. */
  readonly matchesArtifactTemplate: boolean | null;
  /** What the backend is configured with, from /props. Not per-request. */
  readonly configuredTemplateId: string | null;
  readonly configuredTemplateDigest: string | null;
  readonly configuredReasoningFormat: string | null;
  /** Bokahli reports null here, never true: holding a template is not applying one. */
  readonly configuredApplied: boolean | null;
  /** An uncorrelated /slots reading. Backend-instance scope. */
  readonly effectiveTemplateId: string | null;
  /** Always null on this build. Recorded so its absence is explicit. */
  readonly requestConfirmed: boolean;
  readonly reasoningFormatOverridden: boolean | null;
  readonly requestedTemplateId: string | null;
  readonly mismatch: boolean | null;
}

export interface BokahliSamplerFacts {
  readonly requested: Readonly<Record<string, number>> | null;
  readonly sent: Readonly<Record<string, number>> | null;
  /** What an uncorrelated slot reading showed. Not what this request used. */
  readonly effectiveUncorrelated: Readonly<Record<string, number>> | null;
  readonly effectiveSource: string | null;
  /** `backend-instance` until llama.cpp exposes a correlation handle. */
  readonly effectiveScope: string | null;
  readonly seedSupport: string | null;
  readonly deterministicOutputGuaranteed: boolean | null;
}

export interface BokahliInstanceFacts {
  readonly backendInstanceId: string | null;
  readonly backendPid: number | null;
  readonly instanceStartedAt: string | null;
  readonly admissionInstanceId: string | null;
  readonly terminalInstanceId: string | null;
  readonly continuityVerdict: string | null;
  readonly instanceContinuous: boolean | null;
  readonly crossedAttestationTtl: boolean | null;
  readonly revalidation: string | null;
  readonly attestationGeneration: number | null;
  readonly attestationObservedAt: string | null;
  readonly attestationExpiresAt: string | null;
  readonly attestationCompleteness: string | null;
  readonly attestationMissing: readonly string[];
  readonly bindingDigest: string | null;
}

export interface BokahliPlacementFacts {
  readonly method: string | null;
  readonly backendHoldsDevice: boolean | null;
  readonly backendVramMiB: number | null;
  readonly floorMiB: number | null;
  readonly requestedGpuLayers: number | null;
  readonly cpuOffloadEnabled: boolean | null;
  readonly limitation: string | null;
  readonly imageDigest: string | null;
  /**
   * How strongly the image digest is tied to the serving process.
   *
   * Recorded verbatim. `configured-tree` proves what is on disk and must never
   * be presented as process-observed; see `imageDigestIsProcessObserved`.
   */
  readonly imageDigestBinding: string | null;
  readonly imageDigestAlgorithm: string | null;
  readonly processCudaRuntime: string | null;
  readonly driverVersion: string | null;
  readonly driverSupportedCuda: string | null;
}

export interface BokahliTokenizerFacts {
  readonly family: string | null;
  readonly pretokenizer: string | null;
  readonly metadataDigest: string | null;
  readonly metadataBound: boolean | null;
  readonly decodeCanaryVerified: boolean | null;
  readonly encodeCanaryVerified: boolean | null;
  readonly pretokenizerVerified: boolean | null;
  readonly canarySuiteId: string | null;
  readonly canarySuiteHash: string | null;
  readonly verifiedBackendInstanceId: string | null;
  readonly verifiedAt: string | null;
  readonly vocabSizeMatch: boolean | null;
  readonly unprovenReasons: readonly string[];
  /** Bokahli's own verdict on the counts. One input to Luak's, never the answer. */
  readonly declaredTokenCountSource: string | null;
  /** The bound Bokahli attaches to the claim; carried into evidence verbatim. */
  readonly canaryCoverageNote: string | null;
}

export interface BokahliB2Facts {
  /**
   * Whether this response carries the B2 attestation contract at all.
   *
   * The distinction is load-bearing. A B2 response that reports an unknown
   * backend instance is a deployment that failed a check. A Phase 1 response
   * has no instance field because the contract did not have one yet, and
   * treating the two the same would make every attempt against the currently
   * deployed Bokahli unattributable — which would stop the campaign that is
   * meant to run against it, rather than merely refusing its export.
   */
  readonly publishesB2Contract: boolean;
  readonly contractVersion: string | null;
  readonly tokenizer: BokahliTokenizerFacts;
  readonly template: BokahliTemplateFacts;
  readonly sampler: BokahliSamplerFacts;
  readonly instance: BokahliInstanceFacts;
  readonly placement: BokahliPlacementFacts;
  /** True only for the strong form. Never inferred from a digest being present. */
  readonly imageDigestIsProcessObserved: boolean;
}

import {
  boundedString, boundedStrings, digestString, finiteNumber, instantString, numberMap as boundedNumberMap,
  plainObject, readPath, safeCount, strictBoolean,
} from "./bokahli-validate.js";

const obj = plainObject;
const at = readPath;
/** Bounded: a runtime-supplied label must not be able to inflate a record. */
const s_ = boundedString;
const n = finiteNumber;
const b = strictBoolean;
const strings = boundedStrings;
const numberMap = boundedNumberMap;

const EMPTY: BokahliB2Facts = Object.freeze({
  publishesB2Contract: false,
  contractVersion: null,
  tokenizer: {
    family: null, pretokenizer: null, metadataDigest: null, metadataBound: null,
    decodeCanaryVerified: null, encodeCanaryVerified: null, pretokenizerVerified: null,
    canarySuiteId: null, canarySuiteHash: null, verifiedBackendInstanceId: null,
    verifiedAt: null, vocabSizeMatch: null, unprovenReasons: [],
    declaredTokenCountSource: null, canaryCoverageNote: null,
  },
  template: {
    matchesArtifactTemplate: null, configuredTemplateId: null, configuredTemplateDigest: null,
    configuredReasoningFormat: null, configuredApplied: null, effectiveTemplateId: null,
    requestConfirmed: false, reasoningFormatOverridden: null, requestedTemplateId: null,
    mismatch: null,
  },
  sampler: {
    requested: null, sent: null, effectiveUncorrelated: null, effectiveSource: null,
    effectiveScope: null, seedSupport: null, deterministicOutputGuaranteed: null,
  },
  instance: {
    backendInstanceId: null, backendPid: null, instanceStartedAt: null,
    admissionInstanceId: null, terminalInstanceId: null, continuityVerdict: null,
    instanceContinuous: null, crossedAttestationTtl: null, revalidation: null,
    attestationGeneration: null, attestationObservedAt: null, attestationExpiresAt: null,
    attestationCompleteness: null, attestationMissing: [], bindingDigest: null,
  },
  placement: {
    method: null, backendHoldsDevice: null, backendVramMiB: null, floorMiB: null,
    requestedGpuLayers: null, cpuOffloadEnabled: null, limitation: null,
    imageDigest: null, imageDigestBinding: null, imageDigestAlgorithm: null,
    processCudaRuntime: null, driverVersion: null, driverSupportedCuda: null,
  },
  imageDigestIsProcessObserved: false,
});

/** A Phase 1 response carries none of this. Nulls throughout, no crash. */
export function emptyB2Facts(): BokahliB2Facts {
  return EMPTY;
}

export function extractB2Facts(body: unknown): BokahliB2Facts {
  const facts = at(body, "result", "servedIdentity", "qualificationFacts");
  const telemetry = at(body, "telemetry");
  if (obj(facts) === null && obj(telemetry) === null) return EMPTY;

  const tok = at(facts, "tokenizer");
  const tmpl = at(facts, "template");
  const att = at(facts, "attestation");
  const inst = at(facts, "backendInstance");
  const place = at(facts, "placement");
  const rt = at(facts, "runtime");
  const samp = at(telemetry, "sampler");
  const life = at(telemetry, "attemptLifetime");
  const counts = at(telemetry, "tokenCounts");

  const imageBinding = s_(at(rt, "imageDigestBinding"));

  const contractVersion = s_(at(facts, "contractVersion"));
  // Either marker is enough: the facts block names its contract version, and
  // telemetry carries the lifetime record. A body with neither is Phase 1.
  const publishesB2Contract = contractVersion !== null || obj(life) !== null;

  return {
    publishesB2Contract,
    contractVersion,
    tokenizer: {
      family: s_(at(tok, "family")),
      pretokenizer: s_(at(tok, "pretokenizer")),
      metadataDigest: digestString(at(tok, "metadataDigest")),
      metadataBound: b(at(tok, "metadataBound")),
      decodeCanaryVerified: b(at(tok, "decodeCanaryVerified")),
      encodeCanaryVerified: b(at(tok, "encodeCanaryVerified")),
      pretokenizerVerified: b(at(tok, "pretokenizerVerified")),
      canarySuiteId: s_(at(tok, "canarySuiteId")),
      canarySuiteHash: digestString(at(tok, "canarySuiteHash")),
      verifiedBackendInstanceId: s_(at(tok, "verifiedBackendInstanceId")),
      verifiedAt: instantString(at(tok, "verifiedAt")),
      vocabSizeMatch: b(at(tok, "vocabSizeMatch")),
      unprovenReasons: strings(at(tok, "unprovenReasons")),
      declaredTokenCountSource: s_(at(counts, "source")),
      canaryCoverageNote: boundedString(at(tok, "runtimeProof", "canary", "coverageNote"), 2_000),
    },
    template: {
      matchesArtifactTemplate: b(at(tmpl, "configured", "matchesArtifactTemplate")),
      configuredTemplateId: s_(at(tmpl, "configured", "templateId")),
      configuredTemplateDigest: digestString(at(tmpl, "configured", "templateDigest")),
      configuredReasoningFormat: s_(at(tmpl, "configured", "reasoningFormat")),
      configuredApplied: b(at(tmpl, "configured", "applied")),
      effectiveTemplateId: s_(at(tmpl, "effective", "templateId")),
      // Bokahli publishes `requestConfirmed` as an object or null. Anything
      // other than a present object means nothing was confirmed for this
      // request, which is the only value the current llama.cpp API can produce.
      requestConfirmed: obj(at(tmpl, "requestConfirmed")) !== null,
      reasoningFormatOverridden: b(at(tmpl, "reasoningFormatOverridden")),
      requestedTemplateId: s_(at(tmpl, "requested", "templateId")),
      mismatch: b(at(tmpl, "mismatch")),
    },
    sampler: {
      requested: numberMap(at(samp, "requested")),
      sent: numberMap(at(samp, "sent")),
      effectiveUncorrelated: numberMap(at(samp, "effective")),
      effectiveSource: s_(at(samp, "effectiveSource")),
      effectiveScope: s_(at(samp, "effectiveScope")),
      seedSupport: s_(at(samp, "seedSupport")),
      deterministicOutputGuaranteed: b(at(samp, "deterministicOutputGuaranteed")),
    },
    instance: {
      backendInstanceId: s_(at(inst, "instanceId")),
      backendPid: safeCount(at(inst, "pid")),
      instanceStartedAt: instantString(at(inst, "startedAt")),
      admissionInstanceId: s_(at(life, "instanceAtAdmission")),
      terminalInstanceId: s_(at(life, "instanceAtCompletion")),
      continuityVerdict: s_(at(life, "verdict")),
      instanceContinuous: b(at(life, "instanceContinuous")),
      crossedAttestationTtl: b(at(life, "crossedAttestationTtl")),
      revalidation: s_(at(life, "revalidation")),
      attestationGeneration: safeCount(at(att, "generation")),
      attestationObservedAt: instantString(at(att, "observedAt")),
      attestationExpiresAt: instantString(at(att, "expiresAt")),
      attestationCompleteness: s_(at(att, "completeness")),
      attestationMissing: strings(at(att, "missing")),
      bindingDigest: digestString(at(att, "bindingDigest")),
    },
    placement: {
      method: s_(at(place, "method")),
      backendHoldsDevice: b(at(place, "backendHoldsDevice")),
      backendVramMiB: safeCount(at(place, "backendVramMiB")),
      floorMiB: safeCount(at(place, "floorMiB")),
      requestedGpuLayers: safeCount(at(place, "requestedGpuLayers")),
      cpuOffloadEnabled: b(at(place, "cpuOffloadEnabled")),
      limitation: boundedString(at(place, "limitation"), 2_000),
      imageDigest: digestString(at(rt, "imageDigest")),
      imageDigestBinding: imageBinding,
      imageDigestAlgorithm: s_(at(rt, "imageDigestAlgorithm")),
      processCudaRuntime: s_(at(rt, "processCudaRuntime")),
      driverVersion: s_(at(rt, "driverVersion")),
      driverSupportedCuda: s_(at(rt, "driverSupportedCuda")),
    },
    // Only the strong form counts, and only when Bokahli says so by name. A
    // digest being present proves a digest was computed, not what it covers.
    imageDigestIsProcessObserved: imageBinding === "process-mapped",
  };
}

/**
 * Whether Bokahli's output forbids creating a canonical attempt from it.
 *
 * These are infrastructure verdicts, not model results. A campaign records the
 * attempt as an infrastructure event and moves on; scoring it would count a
 * restart, an expired attestation, or an unverifiable deployment against the
 * model's capability.
 */
export function refusesCanonicalAttempt(
  f: BokahliB2Facts,
  attested: boolean | null,
  /**
   * The generation the protocol gate *decided*, not one inferred here.
   *
   * Passing this in is the fix for the downgrade: `publishesB2Contract` is a
   * description of which fields arrived, and letting a description of the
   * fields decide which rules apply is what allowed two deletions to move a
   * response onto the lenient path.
   */
  generation: "b2" | "legacy",
): {
  readonly refuse: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (attested !== true) reasons.push("the served identity was not attested");

  // A legacy-targeted campaign cannot fail checks its contract never had. The
  // attempt runs, the counts stay unprovenanced, and the exporter refuses —
  // the behaviour the pilot was built around, and the reason a campaign against
  // a pre-B2 deployment is still worth running.
  if (generation === "legacy") return { refuse: reasons.length > 0, reasons };

  // In B2 mode the lifetime record must be *present*, not merely non-negative.
  // Every continuity check below compares against a specific bad value, so a
  // deleted record passed all of them: the second downgrade, inside B2 mode.
  if (f.instance.continuityVerdict === null) {
    reasons.push("the response carries no attempt-lifetime verdict, so continuity is unestablished");
  }
  if (f.instance.admissionInstanceId === null || f.instance.terminalInstanceId === null) {
    reasons.push("the attempt names no admission or terminal backend instance");
  }
  if (f.instance.instanceContinuous !== true) {
    reasons.push("continuity across the request was not affirmatively established");
  }
  if (f.tokenizer.metadataBound === null && f.tokenizer.encodeCanaryVerified === null) {
    reasons.push("the response carries no tokenizer proof block");
  }

  if (f.instance.attestationCompleteness === "unattested") {
    reasons.push("the attestation reports completeness 'unattested'");
  }
  if (f.instance.backendInstanceId === null) {
    reasons.push("the backend instance is unknown, so nothing can be bound to it");
  }
  if (f.instance.continuityVerdict === "infrastructure-invalid") {
    reasons.push("Bokahli marked this attempt infrastructure-invalid");
  }
  if (f.instance.instanceContinuous === false) {
    reasons.push("the backend instance changed between admission and completion");
  }
  if (
    f.instance.admissionInstanceId !== null &&
    f.instance.terminalInstanceId !== null &&
    f.instance.admissionInstanceId !== f.instance.terminalInstanceId
  ) {
    // Checked independently of Bokahli's own verdict. The same pid can host a
    // different instance after a restart, so identity — not the pid — is what
    // has to agree.
    reasons.push("the admission and terminal backend instances are different processes");
  }
  return { refuse: reasons.length > 0, reasons };
}
