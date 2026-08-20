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
import { createHash } from "node:crypto";
import type { TokenCountSource } from "../../../types/local-verdict.js";

/** Each precondition, so a failure says which one rather than just "no". */
export interface TokenProvenanceProof {
  /** The response declares the exact contract this campaign was audited against. */
  readonly contractVersionPinned: boolean;
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
  /** Generation is a count and the validity window opens before it closes. */
  readonly attestationCoherent: boolean;
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
  readonly servingInstanceId: string | null;
  readonly admissionInstanceId: string | null;
  readonly terminalInstanceId: string | null;
  /** Binds this verdict to the response it was derived from. */
  readonly seal: string;
}

export interface ProvenanceInput {
  /** The parsed response body. Read defensively; nothing is trusted by shape. */
  readonly body: unknown;
  readonly expectedModelId: string;
  readonly expectedArtifactDigest: string;
  /** The contract version this campaign is pinned to. */
  readonly expectedContractVersion: string;
  /** The generation the protocol gate decided. Legacy can never be proven. */
  readonly protocolGeneration: "b2" | "legacy";
  /** sha256 of the exact response bytes, when the caller has them. */
  readonly rawResponseSha256?: string | null;
}

import {
  boundedString, digestString, finiteNumber as finiteNum, instantString, plainObject, readPath,
  safeCount, strictTrue,
} from "./bokahli-validate.js";

const path = readPath;
const isTrue = strictTrue;
const nonEmptyString = boundedString;
const finiteNumber = finiteNum;
void plainObject;

/** Version of the seal construction. Mixed into the preimage. */
export const PROVENANCE_SEAL_VERSION = "luak.bokahli-provenance-seal.v1";

/**
 * Bind a verdict to the response that produced it.
 *
 * Without this, an unproven attempt can be *enriched* after the fact: add the
 * proof fields, flip the booleans, copy a canary hash and an instance id off a
 * neighbouring attempt that did pass, and the record becomes exportable. The
 * counts never changed and neither did the deployment; only the paperwork did.
 *
 * The seal covers every proof, the identifiers the proofs are bound to, and a
 * digest of the raw response body. Editing any of them changes the seal;
 * recomputing the seal requires the raw body, which is itself covered — so a
 * doctored record is detectable rather than merely improbable.
 */
export function provenanceSeal(input: {
  readonly source: string;
  readonly proof: TokenProvenanceProof;
  readonly declaredSource: string | null;
  readonly canarySuiteId: string | null;
  readonly canarySuiteHash: string | null;
  readonly servingInstanceId: string | null;
  readonly admissionInstanceId: string | null;
  readonly terminalInstanceId: string | null;
  readonly rawResponseSha256: string | null;
}): string {
  const proofBits = (Object.keys(input.proof) as (keyof TokenProvenanceProof)[])
    .sort()
    .map((k) => `${k}=${String(input.proof[k])}`)
    .join(",");
  const preimage = [
    PROVENANCE_SEAL_VERSION,
    `source=${input.source}`,
    `declared=${input.declaredSource ?? ""}`,
    `suite=${input.canarySuiteId ?? ""}:${input.canarySuiteHash ?? ""}`,
    `serving=${input.servingInstanceId ?? ""}`,
    `admission=${input.admissionInstanceId ?? ""}`,
    `terminal=${input.terminalInstanceId ?? ""}`,
    `raw=${input.rawResponseSha256 ?? ""}`,
    proofBits,
  ].join("\n");
  return `sha256:${createHash("sha256").update(preimage).digest("hex")}`;
}

/** Recompute and compare. A verdict whose seal does not match is not a verdict. */
export function verifyProvenanceSeal(
  v: TokenProvenanceVerdict,
  rawResponseSha256: string | null,
): boolean {
  return (
    v.seal ===
    provenanceSeal({
      source: v.source,
      proof: v.proof,
      declaredSource: v.declaredSource,
      canarySuiteId: v.canarySuiteId,
      canarySuiteHash: v.canarySuiteHash,
      servingInstanceId: v.servingInstanceId,
      admissionInstanceId: v.admissionInstanceId,
      terminalInstanceId: v.terminalInstanceId,
      rawResponseSha256,
    })
  );
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
  // A hash, checked as a hash. "yes" is not a content digest.
  const canarySuiteHash = digestString(path(tokenizer, "canarySuiteHash"));

  const unmet: string[] = [];
  const need = (ok: boolean, why: string): boolean => {
    if (!ok) unmet.push(why);
    return ok;
  };

  // Protocol first. A response whose generation was not established, or was
  // established as legacy, cannot prove anything about a tokenizer contract it
  // does not claim to implement.
  const contractVersionPinned = need(
    input.protocolGeneration === "b2" &&
      nonEmptyString(path(facts, "contractVersion")) === input.expectedContractVersion,
    "the response does not declare the pinned Bokahli contract version",
  );

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

  // One instance, named identically everywhere. Served, attested, canary,
  // admission and terminal must all be the same string: a proof that is bound
  // to four of the five and silent about the fifth is bound to nothing.
  const admissionInstance = nonEmptyString(path(lifetime, "instanceAtAdmission"));
  const terminalInstance = nonEmptyString(path(lifetime, "instanceAtCompletion"));
  const canaryInstance = nonEmptyString(path(tokenizer, "verifiedBackendInstanceId"));
  const canaryBoundToServingInstance = need(
    servingInstanceId !== null &&
      canaryInstance === servingInstanceId &&
      admissionInstance === servingInstanceId &&
      terminalInstance === servingInstanceId,
    "the canary, the served identity, the admission and the terminal readings do not all " +
      "name one backend instance",
  );

  // Both counts, and both *sources*. Bokahli reports prompt and completion
  // provenance separately precisely because they can differ, and taking the
  // overall verdict alone would let one proven count carry an unproven one.
  const promptCount = finiteNumber(path(telemetry, "promptTokens"));
  const completionCount = finiteNumber(path(telemetry, "completionTokens"));
  // Presence and provenance are separate questions, and the answer to the first
  // decides `unknown` versus the floor. A Phase 1 response has counts and no
  // provenance for them; that is an unprovenanced measurement, not a missing one.
  const countsPresent =
    promptCount !== null &&
    completionCount !== null &&
    promptCount >= 0 &&
    completionCount >= 0 &&
    Number.isSafeInteger(promptCount) &&
    Number.isSafeInteger(completionCount);
  const runtimeReportedCounts = need(
    countsPresent &&
      nonEmptyString(path(counts, "promptTokenSource")) === "runtime_tokenizer" &&
      nonEmptyString(path(counts, "completionTokenSource")) === "runtime_tokenizer",
    "the prompt and completion counts are not both present as non-negative integers with " +
      "runtime-tokenizer provenance of their own",
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

  // The attestation has to be internally coherent before anything rests on it:
  // a generation that is not a count, or a window that closes before it opens,
  // describes no observation.
  const generation = safeCount(path(attestation, "generation"));
  const observedAt = instantString(path(attestation, "observedAt"));
  const expiresAt = instantString(path(attestation, "expiresAt"));
  const attestationCoherent = need(
    generation !== null &&
      observedAt !== null &&
      expiresAt !== null &&
      Date.parse(expiresAt) > Date.parse(observedAt),
    "the attestation carries no coherent generation and validity window",
  );

  const proof: TokenProvenanceProof = {
    contractVersionPinned,
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
    attestationCoherent,
  };

  // Counts we do not even have are `unknown`; counts we have but cannot
  // attribute are `runtime_reported_unknown_tokenizer`. The distinction matters
  // downstream: one is a missing measurement, the other is an unprovenanced one.
  const source: TokenCountSource =
    unmet.length === 0
      ? "runtime_tokenizer"
      : countsPresent
        ? "runtime_reported_unknown_tokenizer"
        : "unknown";

  const seal = provenanceSeal({
    source, proof, declaredSource, canarySuiteId, canarySuiteHash,
    servingInstanceId, admissionInstanceId: admissionInstance, terminalInstanceId: terminalInstance,
    rawResponseSha256: input.rawResponseSha256 ?? null,
  });

  return {
    source, proof, unmet, declaredSource, canarySuiteId, canarySuiteHash,
    servingInstanceId,
    admissionInstanceId: admissionInstance,
    terminalInstanceId: terminalInstance,
    seal,
  };
}
