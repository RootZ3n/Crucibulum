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

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function at(root: unknown, ...keys: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    const o = obj(cur);
    if (o === null) return undefined;
    cur = o[k];
  }
  return cur;
}
function s(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Tri-state on purpose: absent stays null and never becomes false. */
function b(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function strings(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function numberMap(v: unknown): Readonly<Record<string, number>> | null {
  const o = obj(v);
  if (o === null) return null;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(o)) {
    const num = n(val);
    if (num !== null) out[k] = num;
  }
  return Object.freeze(out);
}

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

  const imageBinding = s(at(rt, "imageDigestBinding"));

  const contractVersion = s(at(facts, "contractVersion"));
  // Either marker is enough: the facts block names its contract version, and
  // telemetry carries the lifetime record. A body with neither is Phase 1.
  const publishesB2Contract = contractVersion !== null || obj(life) !== null;

  return {
    publishesB2Contract,
    contractVersion,
    tokenizer: {
      family: s(at(tok, "family")),
      pretokenizer: s(at(tok, "pretokenizer")),
      metadataDigest: s(at(tok, "metadataDigest")),
      metadataBound: b(at(tok, "metadataBound")),
      decodeCanaryVerified: b(at(tok, "decodeCanaryVerified")),
      encodeCanaryVerified: b(at(tok, "encodeCanaryVerified")),
      pretokenizerVerified: b(at(tok, "pretokenizerVerified")),
      canarySuiteId: s(at(tok, "canarySuiteId")),
      canarySuiteHash: s(at(tok, "canarySuiteHash")),
      verifiedBackendInstanceId: s(at(tok, "verifiedBackendInstanceId")),
      verifiedAt: s(at(tok, "verifiedAt")),
      vocabSizeMatch: b(at(tok, "vocabSizeMatch")),
      unprovenReasons: strings(at(tok, "unprovenReasons")),
      declaredTokenCountSource: s(at(counts, "source")),
      canaryCoverageNote: s(at(tok, "runtimeProof", "canary", "coverageNote")),
    },
    template: {
      matchesArtifactTemplate: b(at(tmpl, "configured", "matchesArtifactTemplate")),
      configuredTemplateId: s(at(tmpl, "configured", "templateId")),
      configuredTemplateDigest: s(at(tmpl, "configured", "templateDigest")),
      configuredReasoningFormat: s(at(tmpl, "configured", "reasoningFormat")),
      configuredApplied: b(at(tmpl, "configured", "applied")),
      effectiveTemplateId: s(at(tmpl, "effective", "templateId")),
      // Bokahli publishes `requestConfirmed` as an object or null. Anything
      // other than a present object means nothing was confirmed for this
      // request, which is the only value the current llama.cpp API can produce.
      requestConfirmed: obj(at(tmpl, "requestConfirmed")) !== null,
      reasoningFormatOverridden: b(at(tmpl, "reasoningFormatOverridden")),
      requestedTemplateId: s(at(tmpl, "requested", "templateId")),
      mismatch: b(at(tmpl, "mismatch")),
    },
    sampler: {
      requested: numberMap(at(samp, "requested")),
      sent: numberMap(at(samp, "sent")),
      effectiveUncorrelated: numberMap(at(samp, "effective")),
      effectiveSource: s(at(samp, "effectiveSource")),
      effectiveScope: s(at(samp, "effectiveScope")),
      seedSupport: s(at(samp, "seedSupport")),
      deterministicOutputGuaranteed: b(at(samp, "deterministicOutputGuaranteed")),
    },
    instance: {
      backendInstanceId: s(at(inst, "instanceId")),
      backendPid: n(at(inst, "pid")),
      instanceStartedAt: s(at(inst, "startedAt")),
      admissionInstanceId: s(at(life, "instanceAtAdmission")),
      terminalInstanceId: s(at(life, "instanceAtCompletion")),
      continuityVerdict: s(at(life, "verdict")),
      instanceContinuous: b(at(life, "instanceContinuous")),
      crossedAttestationTtl: b(at(life, "crossedAttestationTtl")),
      revalidation: s(at(life, "revalidation")),
      attestationGeneration: n(at(att, "generation")),
      attestationObservedAt: s(at(att, "observedAt")),
      attestationExpiresAt: s(at(att, "expiresAt")),
      attestationCompleteness: s(at(att, "completeness")),
      attestationMissing: strings(at(att, "missing")),
      bindingDigest: s(at(att, "bindingDigest")),
    },
    placement: {
      method: s(at(place, "method")),
      backendHoldsDevice: b(at(place, "backendHoldsDevice")),
      backendVramMiB: n(at(place, "backendVramMiB")),
      floorMiB: n(at(place, "floorMiB")),
      requestedGpuLayers: n(at(place, "requestedGpuLayers")),
      cpuOffloadEnabled: b(at(place, "cpuOffloadEnabled")),
      limitation: s(at(place, "limitation")),
      imageDigest: s(at(rt, "imageDigest")),
      imageDigestBinding: imageBinding,
      imageDigestAlgorithm: s(at(rt, "imageDigestAlgorithm")),
      processCudaRuntime: s(at(rt, "processCudaRuntime")),
      driverVersion: s(at(rt, "driverVersion")),
      driverSupportedCuda: s(at(rt, "driverSupportedCuda")),
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
export function refusesCanonicalAttempt(f: BokahliB2Facts, attested: boolean | null): {
  readonly refuse: boolean;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  if (attested !== true) reasons.push("the served identity was not attested");

  // A response that does not publish the contract cannot fail its checks. The
  // attempt runs, the counts stay unprovenanced, and the exporter refuses —
  // which is the behaviour the pilot was built around and the reason a campaign
  // against a pre-B2 deployment is still worth running.
  if (!f.publishesB2Contract) return { refuse: reasons.length > 0, reasons };

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
