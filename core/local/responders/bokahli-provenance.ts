/**
 * Luak — deriving token provenance from what Bokahli actually proved.
 *
 * Until B2 this file did not exist, because there was nothing to derive from.
 * Bokahli returned `promptTokens` and `completionTokens` and said nothing about
 * which tokenizer produced them, so the responder answered
 * `runtime_reported_unknown_tokenizer` — a constant, correct at the time and
 * unfalsifiable by construction. B2 publishes the proof, so the constant has to
 * go: a hardcoded answer cannot get better when the evidence does, and it
 * cannot get worse when the evidence disappears either.
 *
 * ## The rule
 *
 * `runtime_tokenizer` is claimable only when every one of these holds. They are
 * separate checks rather than one composite because each fails for a different
 * reason and a campaign operator needs to know which:
 *
 *   1. the served identity is the exact artifact this campaign is about;
 *   2. the backend was attested and names a known instance;
 *   3. the tokenizer's file-side identity is bound to that attested artifact;
 *   4. the **encode** canary passed — the direction the counts come from;
 *   5. the **decode** canary passed;
 *   6. the canary names a suite and carries its content hash;
 *   7. that canary was verified against the *serving* instance;
 *   8. the counts are runtime-reported numbers, not absent;
 *   9. Bokahli's own verdict is `runtime_tokenizer`;
 *  10. the attempt was admitted under valid evidence; and
 *  11. the backend instance did not change under the request.
 *
 * ## What Bokahli's own label is worth
 *
 * Exactly one vote out of eleven. `telemetry.tokenCounts.source` is a field in
 * a JSON body, and a field that can name its own provenance can name a better
 * one than it has — through a bug upstream, a proxy, a replayed capture, or a
 * hand-edited fixture someone is using to make a red campaign go green. So the
 * label is *necessary* and never *sufficient*: the supporting object has to be
 * present and consistent with it. A response cannot self-label its way to
 * exportability.
 *
 * Anything missing, false, expired, mismatched, or simply unknown leaves the
 * verdict at `runtime_reported_unknown_tokenizer`, which the exporter refuses
 * with a typed reason. Absence is never evidence.
 */
import type { TokenCountSource } from "../../../types/local-verdict.js";

/** Each precondition, so a failure says which one rather than just "no". */
export interface TokenProvenanceProof {
  readonly identityExact: boolean;
  readonly attestedBackendInstance: boolean;
  readonly metadataBound: boolean;
  readonly encodeCanaryVerified: boolean;
  readonly decodeCanaryVerified: boolean;
  readonly canarySuiteIdentified: boolean;
  readonly canaryBoundToServingInstance: boolean;
  readonly runtimeReportedCounts: boolean;
  readonly bokahliDeclaredRuntimeTokenizer: boolean;
  readonly admittedUnderValidAttestation: boolean;
  readonly backendInstanceContinuous: boolean;
}

export interface TokenProvenanceVerdict {
  readonly source: TokenCountSource;
  readonly proof: TokenProvenanceProof;
  /** Human-readable reasons, in the order the checks are listed. Empty when proven. */
  readonly unmet: readonly string[];
  /** Bokahli's own verdict, recorded separately from ours. */
  readonly declaredSource: string | null;
  readonly canarySuiteId: string | null;
  readonly canarySuiteHash: string | null;
}

export interface ProvenanceInput {
  /** The parsed response body. Read defensively; nothing is trusted by shape. */
  readonly body: unknown;
  readonly expectedModelId: string;
  readonly expectedArtifactDigest: string;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function path(root: unknown, ...keys: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    const o = obj(cur);
    if (o === null) return undefined;
    cur = o[k];
  }
  return cur;
}
/** True only for a literal `true`. A missing or truthy-ish value is not a proof. */
function isTrue(v: unknown): boolean {
  return v === true;
}
function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Decide what may be claimed about the counts in this response.
 *
 * Never throws and never reads a field it has not checked the shape of: this
 * runs on a body that arrived over a network, and a parser that can be crashed
 * by the thing it is measuring is not a measurement.
 */
export function deriveTokenProvenance(input: ProvenanceInput): TokenProvenanceVerdict {
  const { body } = input;
  const served = path(body, "result", "servedIdentity");
  const facts = path(served, "qualificationFacts");
  const tokenizer = path(facts, "tokenizer");
  const attestation = path(facts, "attestation");
  const instance = path(facts, "backendInstance");
  const telemetry = path(body, "telemetry");
  const counts = path(telemetry, "tokenCounts");
  const lifetime = path(telemetry, "attemptLifetime");

  const servingInstanceId = nonEmptyString(path(instance, "instanceId"));
  const declaredSource = nonEmptyString(path(counts, "source"));
  const canarySuiteId = nonEmptyString(path(tokenizer, "canarySuiteId"));
  const canarySuiteHash = nonEmptyString(path(tokenizer, "canarySuiteHash"));

  const unmet: string[] = [];
  const need = (ok: boolean, why: string): boolean => {
    if (!ok) unmet.push(why);
    return ok;
  };

  const identityExact = need(
    nonEmptyString(path(served, "modelId")) === input.expectedModelId &&
      nonEmptyString(path(served, "digest")) === input.expectedArtifactDigest,
    "the served identity is not the exact artifact this campaign is about",
  );

  // Attested, *and* naming an instance. Attestation without an instance cannot
  // be bound to anything afterwards, which is the whole point of binding it.
  const attestedBackendInstance = need(
    isTrue(path(served, "attested")) &&
      servingInstanceId !== null &&
      nonEmptyString(path(attestation, "backendInstanceId")) === servingInstanceId &&
      path(attestation, "completeness") !== "unattested",
    "the backend was not attested, or the attestation names no backend instance",
  );

  const metadataBound = need(
    isTrue(path(tokenizer, "metadataBound")),
    "the tokenizer's file identity is not bound to the attested artifact",
  );

  // The direction the counts come from. A runtime can keep the whole token
  // table and still segment text differently.
  const encodeCanaryVerified = need(
    isTrue(path(tokenizer, "encodeCanaryVerified")),
    "the encode canary did not pass, so nothing established how this runtime turns text into ids",
  );

  const decodeCanaryVerified = need(
    isTrue(path(tokenizer, "decodeCanaryVerified")),
    "the decode canary did not pass",
  );

  const canarySuiteIdentified = need(
    canarySuiteId !== null && canarySuiteHash !== null,
    "the canary names no suite or carries no content hash, so what was checked is unidentifiable",
  );

  const canaryBoundToServingInstance = need(
    servingInstanceId !== null &&
      nonEmptyString(path(tokenizer, "verifiedBackendInstanceId")) === servingInstanceId,
    "the canary was verified against a different backend instance than the one that served",
  );

  const runtimeReportedCounts = need(
    finiteNumber(path(telemetry, "promptTokens")) !== null &&
      finiteNumber(path(telemetry, "completionTokens")) !== null,
    "the response carries no runtime-reported prompt and completion counts",
  );

  // Necessary, never sufficient. Listed last among the tokenizer checks so the
  // ten above have already had their say.
  const bokahliDeclaredRuntimeTokenizer = need(
    declaredSource === "runtime_tokenizer",
    `Bokahli's own verdict is ${declaredSource ?? "absent"}, not runtime_tokenizer`,
  );

  const admittedUnderValidAttestation = need(
    isTrue(path(lifetime, "attestationValidAtAdmission")),
    "the attempt was admitted on evidence that had already lapsed",
  );

  const backendInstanceContinuous = need(
    isTrue(path(lifetime, "instanceContinuous")) && path(lifetime, "verdict") === "valid",
    "the backend instance did not survive the request, or continuity could not be established",
  );

  const proof: TokenProvenanceProof = {
    identityExact,
    attestedBackendInstance,
    metadataBound,
    encodeCanaryVerified,
    decodeCanaryVerified,
    canarySuiteIdentified,
    canaryBoundToServingInstance,
    runtimeReportedCounts,
    bokahliDeclaredRuntimeTokenizer,
    admittedUnderValidAttestation,
    backendInstanceContinuous,
  };

  // Counts we do not even have are `unknown`; counts we have but cannot
  // attribute are `runtime_reported_unknown_tokenizer`. The distinction matters
  // downstream: one is a missing measurement, the other is an unprovenanced one.
  const source: TokenCountSource =
    unmet.length === 0
      ? "runtime_tokenizer"
      : runtimeReportedCounts
        ? "runtime_reported_unknown_tokenizer"
        : "unknown";

  return { source, proof, unmet, declaredSource, canarySuiteId, canarySuiteHash };
}
