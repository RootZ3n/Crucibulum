/**
 * Luak — Bokahli qualification-bundle exporter.
 *
 * Produces the import bundle Bokahli's Phase 2A contract describes, from Luak's
 * own attempt records. It is the only place the two systems touch, and it is
 * written to be uncooperative: almost everything here is a refusal.
 *
 * Three properties are load-bearing.
 *
 * **It never claims trust.** Bokahli separates payload integrity (a hash it
 * computes), upstream provenance (what the payload claims) and import trust
 * (what an operator pinned). The exporter fills the first two and is
 * structurally unable to fill the third — there is no field for it in what this
 * module emits, and `verifiedByBokahli` is written as the literal `false`.
 * Authorising evidence is an operator's act on the Bokahli side, and a Luak
 * flag saying "trust me" would be exactly the self-declaration that Bokahli's
 * audit removed.
 *
 * **It never fabricates.** Every aggregate is recomputed from the attempts in
 * the export, and an aggregate that disagrees with its attempts is refused
 * rather than corrected. Missing measurements stay `null`; nothing is defaulted
 * to zero, because zero is a measurement and `null` is the absence of one.
 *
 * **It never launders attribution.** A result that Luak could not attribute to
 * the model alone cannot leave here as a model score. That is what stops "our
 * regex successfully interpreted something that looked vaguely like a shell
 * command" from becoming "this model can use tools".
 */
import { createHash } from "node:crypto";
import {
  checkLocalIdentity,
  type LocalModelIdentity,
} from "../../types/local-identity.js";
import {
  LOCAL_FAILURE_MAP,
  type AttributionClass,
  type LocalFailureCode,
} from "../../types/local-verdict.js";
// Imported from the canonical module rather than restated, so the exporter
// cannot emit an origin Luak does not define.
import type { FailureOrigin } from "../../types/verdict.js";
import { LOCAL_REGIME_VERSION, type AttemptRecord, type ScoredAttempt } from "./regime.js";

export const BOKAHLI_BUNDLE_VERSION = "2.0.0-phase2a" as const;

/**
 * The exporter's own version, distinct from the bundle format's.
 *
 * These moved together until the evidence-transport correction, which changed
 * everything about how a campaign is *run* and nothing about the bundle's
 * shape. Advancing BOKAHLI_BUNDLE_VERSION would have told Bokahli its pinned
 * wire contract had changed, which is false, and its importer would have
 * refused a bundle it understands perfectly.
 *
 * So the two are separated. The bundle version describes the wire. This
 * describes the process that produced it, and it travels in provenance —
 * where Bokahli records it and grants it exactly no authority.
 */
export const LUAK_EXPORTER_VERSION = "luak.bokahli-exporter-2.1.0" as const;

/** Task-class contract versions this exporter can produce evidence for. */
export const SUPPORTED_TASK_CONTRACTS: Readonly<Record<string, string>> = Object.freeze({
  test_log_triage: "1.0.0",
  repo_reconnaissance: "1.0.0",
});

export type ExportRefusalCode =
  | "NO_LOCAL_IDENTITY"
  | "INCOMPLETE_LOCAL_IDENTITY"
  | "UNSUPPORTED_TASK_CLASS"
  | "UNSUPPORTED_TASK_CONTRACT_VERSION"
  | "NO_ATTEMPTS"
  | "INCOMPLETE_ATTEMPT_RECORD"
  | "NON_MODEL_ATTRIBUTION"
  | "TOOL_CAPABILITY_NOT_DEMONSTRATED"
  | "MISSING_SUITE_VERSION"
  | "MISSING_REGIME_VERSION"
  | "CONTEXT_TIER_NOT_MEASURED"
  | "FABRICATED_AGGREGATE"
  | "MIXED_SUITE"
  | "MIXED_SUITE_VERSION"
  | "MIXED_CONTEXT_TIER"
  // Evidence transport, added with bundle 2.1.0. A campaign that did not send
  // untrusted material through Bokahli's evidence[] contract did not test the
  // boundary, and must not export as though it had.
  | "MIXED_EVIDENCE_TRANSPORT"
  | "LEGACY_EVIDENCE_TRANSPORT"
  | "MIXED_EVIDENCE_TRANSPORT_VERSION"
  | "EVIDENCE_TRANSPORT_EMPTY"
  | "EVIDENCE_TRANSPORT_INCONSISTENT"
  | "EVIDENCE_TRANSPORT_DUPLICATE_PACKET"
  | "EVIDENCE_TRANSPORT_UNCONFIRMED"
  | "EVIDENCE_TRANSPORT_UNSCANNED"
  | "EVIDENCE_NOT_FENCED"
  | "MIXED_DETECTOR"
  | "IDENTITY_ATTEMPT_DISAGREEMENT"
  | "NO_EVIDENCE_OF_EXECUTION"
  | "TOKEN_COUNTS_NOT_MEASURED"
  | "DEVELOPMENT_SPLIT_AS_QUALIFICATION";

export interface ExportRefusal {
  readonly code: ExportRefusalCode;
  readonly detail: string;
  readonly field: string | null;
}

export type ExportResult =
  | { readonly ok: true; readonly bundle: BokahliBundle }
  | { readonly ok: false; readonly refusals: readonly ExportRefusal[] };

export interface BokahliBundle {
  readonly bundleVersion: typeof BOKAHLI_BUNDLE_VERSION;
  readonly key: Readonly<Record<string, string>>;
  readonly hardwareProfile: Readonly<Record<string, unknown>>;
  readonly verdict: "QUALIFIED" | "DISQUALIFIED";
  readonly attempts: readonly Readonly<Record<string, unknown>>[];
  readonly aggregate: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
  readonly expiresAt: string | null;
  readonly contentHash: string;
}

export interface ExportInput {
  readonly taskClass: string;
  readonly taskClassContractVersion: string;
  readonly identity: LocalModelIdentity | null;
  readonly records: readonly AttemptRecord[];
  readonly scored: readonly ScoredAttempt[];
  /** Luak's own bundle ids and hashes, carried as provenance only. */
  readonly luakBundleIds: readonly string[];
  readonly luakBundleHashes: readonly string[];
  readonly luakSignatureStatus: string | null;
  readonly luakRepoCommit: string | null;
  /**
   * Luak's verdict. Defaults to DISQUALIFIED, because this phase has run no
   * campaign and chosen no thresholds — there is nothing on which to base the
   * other value.
   */
  readonly verdict?: "QUALIFIED" | "DISQUALIFIED";
  /**
   * Require every attempt to come from the evaluation split. Defaults to true:
   * an export is qualification evidence unless someone deliberately says it is
   * a development snapshot.
   */
  readonly requireEvaluationSplit?: boolean;
  /** Injected so exports are reproducible and testable. */
  readonly now: Date;
  readonly expiresAt?: string | null;
}

// ---------------------------------------------------------------------------
// canonicalisation, matching Bokahli's documented contract
// ---------------------------------------------------------------------------

const BOKAHLI_HASH_DOMAIN = "bokahli.canonical-json.sha256.v1";

/**
 * Bokahli's canonical form: keys sorted by UTF-16 code unit, arrays untouched,
 * `-0` normalised, unsafe integers and non-finite numbers refused.
 *
 * Reimplemented here rather than shared, because the two repositories must be
 * able to disagree. If Bokahli changes its canonicalisation, this exporter's
 * hash stops matching and the import fails loudly — which is the correct
 * outcome, and one a shared library would hide.
 */
function canonicalJson(v: unknown, depth = 0): string {
  if (depth > 64) throw new Error("canonicalisation depth exceeded");
  if (v === null) return "null";
  const t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number") {
    const n = v as number;
    if (!Number.isFinite(n)) throw new Error(`${String(n)} has no JSON representation`);
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
      throw new Error(`${n} cannot round-trip through JSON`);
    }
    return JSON.stringify(n === 0 ? 0 : n);
  }
  if (t === "string") return JSON.stringify(v);
  if (t === "undefined") throw new Error("undefined is not canonicalisable; use null");
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x, depth + 1)).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k], depth + 1)}`).join(",")}}`;
}

function bokahliContentHash(bundleWithoutHash: Record<string, unknown>): string {
  const preimage =
    `${BOKAHLI_HASH_DOMAIN}\nexcluding:${JSON.stringify("contentHash")}\n` +
    canonicalJson(bundleWithoutHash);
  return `sha256:${createHash("sha256").update(preimage, "utf8").digest("hex")}`;
}

// ---------------------------------------------------------------------------
// attempt projection
// ---------------------------------------------------------------------------

const OUTCOME_MAP: Readonly<Record<string, string | null>> = Object.freeze({
  PASS: "PASS",
  PARTIAL: "PARTIAL",
  FAIL: "FAIL",
  INCOMPLETE: "INCOMPLETE",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
  HARNESS_FAILURE: "HARNESS_FAILURE",
  // Not exportable. A lane that did not apply produced no measurement, and a
  // non-measurement must not travel as one.
  NOT_APPLICABLE: null,
  UNSUPPORTED_CAPABILITY: null,
});

function originFor(
  codes: readonly LocalFailureCode[],
  attribution: AttributionClass,
): FailureOrigin | null {
  if (codes.length === 0) return null;
  const first = codes.find((c) => LOCAL_FAILURE_MAP[c].failureOrigin !== null);
  if (first) return LOCAL_FAILURE_MAP[first].failureOrigin;
  return attribution === "MODEL" ? "MODEL" : "UNKNOWN";
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export function exportBokahliBundle(rawInput: ExportInput): ExportResult {
  const input: ExportInput = { requireEvaluationSplit: true, ...rawInput };
  const refusals: ExportRefusal[] = [];
  const add = (code: ExportRefusalCode, detail: string, field: string | null = null): void => {
    refusals.push({ code, detail, field });
  };

  // 1. Local identity. A hosted bundle reaching this function is the case the
  //    refusal exists for: it is valid evidence about something, and not about
  //    an artifact on a runtime on a machine.
  if (!input.identity) {
    add("NO_LOCAL_IDENTITY",
      "this evidence carries no local identity. Hosted evidence is valid in its own lane " +
      "and is never local qualification evidence: without an artifact digest, quantisation, " +
      "runtime build and hardware profile there is no specific thing it is evidence about.",
      "identity");
  } else {
    const check = checkLocalIdentity(input.identity);
    if (!check.ok) {
      for (const p of check.missing) {
        add("INCOMPLETE_LOCAL_IDENTITY", `required local identity field is absent: ${p}`, p);
      }
      for (const inv of check.invalid) {
        add("INCOMPLETE_LOCAL_IDENTITY", `${inv.path}: ${inv.why}`, inv.path);
      }
    }
    if (!input.identity.fixtureSuiteVersion) {
      add("MISSING_SUITE_VERSION", "fixtureSuiteVersion is required", "identity.fixtureSuiteVersion");
    }
    if (!input.identity.verificationRegimeVersion) {
      add("MISSING_REGIME_VERSION", "verificationRegimeVersion is required", "identity.verificationRegimeVersion");
    }
    // A context tier named but never measured is the character-count-as-token-count
    // error arriving through the side door.
    if (input.identity.context.tokenCountSource !== "runtime_tokenizer") {
      add("CONTEXT_TIER_NOT_MEASURED",
        `context.tokenCountSource is "${input.identity.context.tokenCountSource}". A context ` +
        "tier must be measured with the model's own tokenizer at execution time; a character " +
        "count is fixture-generation metadata and is not a token count.",
        "identity.context.tokenCountSource");
    }
  }

  // 2. Task contract.
  const expected = SUPPORTED_TASK_CONTRACTS[input.taskClass];
  if (!expected) {
    add("UNSUPPORTED_TASK_CLASS",
      `no local suite defines "${input.taskClass}" (have: ${Object.keys(SUPPORTED_TASK_CONTRACTS).join(", ")})`,
      "taskClass");
  } else if (expected !== input.taskClassContractVersion) {
    add("UNSUPPORTED_TASK_CONTRACT_VERSION",
      `this build produces evidence against ${input.taskClass} ${expected}, not ` +
      `${input.taskClassContractVersion}. A different contract is a different question.`,
      "taskClassContractVersion");
  }

  // 3. Attempts.
  if (input.scored.length === 0) {
    add("NO_ATTEMPTS", "a verdict with no attempts behind it is an assertion, not evidence", "attempts");
  }
  const byId = new Map(input.records.map((r) => [r.attemptId, r]));
  for (const s of input.scored) {
    const rec = byId.get(s.attemptId);
    if (!rec) {
      add("INCOMPLETE_ATTEMPT_RECORD",
        `scored attempt ${s.attemptId} has no underlying record; evidence must be derived ` +
        "from attempts, never assembled beside them",
        `attempts.${s.attemptId}`);
      continue;
    }
    if (!rec.suiteId || !rec.suiteVersion) {
      add("MISSING_SUITE_VERSION", `attempt ${s.attemptId} does not name its suite and version`,
        `attempts.${s.attemptId}.suiteVersion`);
    }
    if (s.regimeVersion !== LOCAL_REGIME_VERSION) {
      add("MISSING_REGIME_VERSION",
        `attempt ${s.attemptId} was scored under regime ${s.regimeVersion}, this build is ` +
        `${LOCAL_REGIME_VERSION}; mixing regimes in one bundle makes the aggregate meaningless`,
        `attempts.${s.attemptId}.regimeVersion`);
    }
    if (OUTCOME_MAP[s.outcome] === null) {
      add("NON_MODEL_ATTRIBUTION",
        `attempt ${s.attemptId} is ${s.outcome}: the lane did not apply to this interface, so ` +
        "it produced no measurement. Exporting it would turn an interface mismatch into a result.",
        `attempts.${s.attemptId}.outcome`);
    }
    // 4. Attribution laundering.
    if (s.attribution === "COMPOSITE") {
      add("NON_MODEL_ATTRIBUTION",
        `attempt ${s.attemptId} is COMPOSITE: Luak could not separate the model's behaviour ` +
        "from the harness's. It may be compared and inspected; it may not be exported as a " +
        "model score.",
        `attempts.${s.attemptId}.attribution`);
    }
    if (s.failureCodes.includes("local_harness_extraction_failure")) {
      add("TOOL_CAPABILITY_NOT_DEMONSTRATED",
        `attempt ${s.attemptId} failed because Luak's free-text extractor did not recognise ` +
        "the model's output. That is not a demonstration that the model cannot use tools, and " +
        "it must not be exported as one. Native tool capability requires a lane that observes " +
        "structured calls directly.",
        `attempts.${s.attemptId}`);
    }
  }

  // 5. Homogeneity. One bundle describes one deployment running one suite at one
  //    tier; anything else is several runs wearing a single identity, and the
  //    aggregate over them means nothing. The first draft exported all of these.
  const suiteIds = new Set(input.records.map((r) => r.suiteId));
  const suiteVersions = new Set(input.records.map((r) => `${r.suiteId}@${r.suiteVersion}`));
  const tiers = new Set(input.records.map((r) => r.contextTier ?? "(none)"));

  if (suiteIds.size > 1) {
    add("MIXED_SUITE",
      `attempts span ${suiteIds.size} fixture suites (${[...suiteIds].join(", ")}). ` +
      "One bundle is evidence about one suite; aggregating across suites produces a " +
      "pass rate over two different questions.",
      "attempts[].suiteId");
  }
  if (suiteVersions.size > 1) {
    add("MIXED_SUITE_VERSION",
      `attempts span ${suiteVersions.size} suite versions (${[...suiteVersions].join(", ")}). ` +
      "A suite that gained a fixture is a different bar.",
      "attempts[].suiteVersion");
  }
  if (tiers.size > 1) {
    add("MIXED_CONTEXT_TIER",
      `attempts span ${tiers.size} context tiers (${[...tiers].join(", ")}). ` +
      "The bundle carries one contextTierTokens, so exporting a mixture would stamp " +
      "every attempt with a tier most of them did not run at.",
      "attempts[].contextTier");
  }
  // 5b. Evidence transport. A campaign that measured injection resistance
  //     without sending the material as evidence measured the harness, not the
  //     model — which is exactly what the first Bokahli campaign did, and its
  //     records look identical to a correct campaign's unless something refuses
  //     them. Absence is the discriminator: pre-transport records carry no block
  //     at all, and there is no value they could carry that would forge one,
  //     because the boundary fields come from Bokahli rather than from Luak.
  const withTransport = input.records.filter((r) => r.evidenceTransport != null);
  const withoutTransport = input.records.filter((r) => r.evidenceTransport == null);

  if (withTransport.length > 0 && withoutTransport.length > 0) {
    add("MIXED_EVIDENCE_TRANSPORT",
      `${withTransport.length} of ${input.records.length} attempts used the typed ` +
      "evidence transport and the rest did not. The two are not comparable: one " +
      "exercised Bokahli's evidence boundary and the other handed the same bytes to " +
      "the model as the caller's own instruction.",
      "attempts[].evidenceTransport");
  } else if (withoutTransport.length === input.records.length && input.records.length > 0) {
    add("LEGACY_EVIDENCE_TRANSPORT",
      "no attempt carries an evidence-transport record. These were produced before " +
      "untrusted fixture material travelled through Bokahli's evidence[] contract, so " +
      "any injection result in them is a statement about the harness. Re-run the " +
      "campaign; this evidence cannot be repaired by re-exporting it.",
      "attempts[].evidenceTransport");
  }

  const transportVersions = new Set(
    withTransport.map((r) => r.evidenceTransport!.transportVersion),
  );
  if (transportVersions.size > 1) {
    add("MIXED_EVIDENCE_TRANSPORT_VERSION",
      `attempts span ${transportVersions.size} evidence transport versions ` +
      `(${[...transportVersions].join(", ")}).`,
      "attempts[].evidenceTransport.transportVersion");
  }

  for (const r of withTransport) {
    const t = r.evidenceTransport!;
    if (t.packetCount === 0) {
      add("EVIDENCE_TRANSPORT_EMPTY",
        `attempt ${r.attemptId} claims the evidence transport but sent no packets. A ` +
        "stripped evidence[] is a campaign that asked the model about material it never " +
        "received.",
        `attempts.${r.attemptId}.evidenceTransport.packetCount`);
    }
    if (t.packetIds.length !== t.packetCount) {
      add("EVIDENCE_TRANSPORT_INCONSISTENT",
        `attempt ${r.attemptId} reports ${t.packetCount} packets but names ` +
        `${t.packetIds.length}.`,
        `attempts.${r.attemptId}.evidenceTransport.packetIds`);
    }
    if (new Set(t.packetIds).size !== t.packetIds.length) {
      add("EVIDENCE_TRANSPORT_DUPLICATE_PACKET",
        `attempt ${r.attemptId} sent the same packet id twice; one packet cannot stand ` +
        "in for another's digest.",
        `attempts.${r.attemptId}.evidenceTransport.packetIds`);
    }
    // The boundary's own confirmation. Null means the deployment said nothing,
    // which is not the same as saying it found nothing, and a campaign cannot
    // claim a boundary ran on the strength of its own intention to invoke it.
    if (t.scannedAll === null || t.boundaryDecision === null) {
      add("EVIDENCE_TRANSPORT_UNCONFIRMED",
        `attempt ${r.attemptId} carries no trust-boundary telemetry, so there is no ` +
        "evidence the packets were inspected. Luak's intent to use the evidence channel " +
        "is not proof that the deployment did.",
        `attempts.${r.attemptId}.evidenceTransport.boundaryDecision`);
    } else if (t.scannedAll === false) {
      add("EVIDENCE_TRANSPORT_UNSCANNED",
        `attempt ${r.attemptId} ran against a deployment that did not inspect every ` +
        "packet it was given.",
        `attempts.${r.attemptId}.evidenceTransport.scannedAll`);
    }
    if (t.fencedPacketCount !== null && t.packetCount > 0 && t.fencedPacketCount === 0) {
      add("EVIDENCE_NOT_FENCED",
        `attempt ${r.attemptId} sent ${t.packetCount} evidence packet(s) and the boundary ` +
        "fenced none of them. Untrusted material that was not fenced reached the model " +
        "with the same standing as the caller's instruction.",
        `attempts.${r.attemptId}.evidenceTransport.fencedPacketCount`);
    }
  }

  const detectors = new Set(
    withTransport.map((r) => r.evidenceTransport!.detectorVersion).filter((d) => d !== null),
  );
  const registries = new Set(
    withTransport.map((r) => r.evidenceTransport!.registryPayloadSha256).filter((d) => d !== null),
  );
  if (detectors.size > 1 || registries.size > 1) {
    add("MIXED_DETECTOR",
      "attempts ran against more than one detector version or pattern registry. " +
      "Injection results from different detectors are not one measurement.",
      "attempts[].evidenceTransport.detectorVersion");
  }

  if (input.identity && suiteIds.size === 1) {
    const only = [...suiteIds][0];
    if (only !== input.identity.fixtureSuiteId) {
      add("IDENTITY_ATTEMPT_DISAGREEMENT",
        `identity names fixture suite "${input.identity.fixtureSuiteId}" but every attempt ` +
        `ran "${only}"`, "identity.fixtureSuiteId");
    }
    const onlyVersion = [...suiteVersions][0]?.split("@")[1];
    if (onlyVersion && onlyVersion !== input.identity.fixtureSuiteVersion) {
      add("IDENTITY_ATTEMPT_DISAGREEMENT",
        `identity names suite version "${input.identity.fixtureSuiteVersion}" but the ` +
        `attempts ran "${onlyVersion}"`, "identity.fixtureSuiteVersion");
    }
  }

  // 6. Proof of execution. A record with no lanes and no runtime failure is a
  //    record of nothing — the shape a hand-authored attempt has, because
  //    writing plausible metadata is easy and producing a scored lane is not.
  for (const rec of input.records) {
    if (rec.applicability === "APPLICABLE" && rec.lanes.length === 0) {
      add("NO_EVIDENCE_OF_EXECUTION",
        `attempt ${rec.attemptId} carries no lane scores. Evidence is derived from scored ` +
        "lanes; an attempt with none was never run through a scorer.",
        `attempts.${rec.attemptId}.lanes`);
    }
    if (rec.tokenCountSource !== "runtime_tokenizer") {
      add("TOKEN_COUNTS_NOT_MEASURED",
        `attempt ${rec.attemptId} reports tokenCountSource "${rec.tokenCountSource}". ` +
        "Token counts must come from the runtime's own tokenizer; an estimate is a " +
        "character count wearing a token label.",
        `attempts.${rec.attemptId}.tokenCountSource`);
    }
    if (rec.applicability === "APPLICABLE" && (rec.promptTokens === null || rec.completionTokens === null)) {
      add("TOKEN_COUNTS_NOT_MEASURED",
        `attempt ${rec.attemptId} has null token counts`,
        `attempts.${rec.attemptId}.promptTokens`);
    }
    // 7. Split policy. Development fixtures are the ones tuning may have touched.
    if (input.requireEvaluationSplit && rec.split !== "evaluation") {
      add("DEVELOPMENT_SPLIT_AS_QUALIFICATION",
        `attempt ${rec.attemptId} ran development fixture "${rec.fixtureId}". A ` +
        "qualification export must use the evaluation split, which is excluded from " +
        "development tuning by policy.",
        `attempts.${rec.attemptId}.split`);
    }
  }

  if (refusals.length > 0) return { ok: false, refusals };

  // 8. Build the bundle from the attempts, recomputing every aggregate.
  const identity = input.identity as LocalModelIdentity;
  const exportable = input.scored.filter((s) => OUTCOME_MAP[s.outcome] !== null);

  const attempts = exportable.map((s) => {
    const rec = byId.get(s.attemptId) as AttemptRecord;
    return {
      attemptId: s.attemptId,
      fixtureId: s.fixtureId,
      outcome: OUTCOME_MAP[s.outcome] as string,
      failureOrigin: originFor(s.failureCodes, s.attribution),
      failureReasonCode: s.failureCodes.length
        ? LOCAL_FAILURE_MAP[s.failureCodes[0] as LocalFailureCode].legacyReasonCode
        : null,
      score: s.score,
      contextTierTokens: identity.context.effectiveMaxTokens,
      tokens: { promptTokens: rec.promptTokens, completionTokens: rec.completionTokens },
      timings: {
        timeToFirstTokenMs: rec.timeToFirstTokenMs,
        prefillTokensPerSecond: null,
        decodeTokensPerSecond: rec.decodeTokensPerSecond,
        wallTimeMs: rec.wallTimeMs,
      },
      compliance: {
        outputSchemaValid: laneBool(s, "citation", "facts") === null ? null : !s.failureCodes.includes("local_invalid_structured_output"),
        citationsValid: s.laneScores["citation"] === undefined ? null : !s.failureCodes.includes("local_citation_unsupported"),
        toolCallsValid: null,
      },
      sourceRef: `${rec.suiteId}@${rec.suiteVersion}/${rec.fixtureId}`,
    };
  });

  const aggregate = recomputeAggregate(attempts, identity);

  const unhashed = {
    bundleVersion: BOKAHLI_BUNDLE_VERSION,
    key: {
      modelId: identity.artifact.modelId,
      artifactDigest: identity.artifact.artifactDigest,
      quantization: identity.artifact.quantization,
      runtimeName: identity.runtime.name,
      runtimeBuild: identity.runtime.build,
      hardwareProfileId: identity.hardware.profileId,
      taskClass: input.taskClass,
      taskClassContractVersion: input.taskClassContractVersion,
      fixtureSuiteId: identity.fixtureSuiteId,
      fixtureSuiteVersion: identity.fixtureSuiteVersion,
      verificationRegimeVersion: identity.verificationRegimeVersion,
    },
    hardwareProfile: {
      id: identity.hardware.profileId,
      gpuModel: identity.hardware.gpuModel,
      gpuMemoryMiB: identity.hardware.gpuMemoryMiB,
      gpuDriver: identity.hardware.gpuDriver,
      cudaVersion: identity.hardware.cudaVersion,
      cpuModel: identity.hardware.cpuModel,
      systemMemoryMiB: identity.hardware.systemMemoryMiB,
      partialOffload: identity.placement.cpuOffloadEnabled,
      note: null,
    },
    verdict: input.verdict ?? ("DISQUALIFIED" as const),
    attempts,
    aggregate,
    provenance: {
      claimedAuthority: "luak",
      // Regime, fixture suite, exporter and evidence transport. A campaign run
      // before untrusted material travelled through Bokahli's evidence[]
      // contract cannot produce this string, and one run after it cannot fail
      // to: the transport version is read from the records, not asserted here.
      sourceContractVersion:
        `${LOCAL_REGIME_VERSION}+${identity.fixtureSuiteId}@${identity.fixtureSuiteVersion}` +
        `+${LUAK_EXPORTER_VERSION}` +
        `+${[...new Set(input.records.map((r) => r.evidenceTransport?.transportVersion ?? "no-evidence-transport"))].sort().join(",")}`,
      luakBundleIds: [...input.luakBundleIds],
      luakBundleHashes: [...input.luakBundleHashes],
      claimedSignatureStatus: input.luakSignatureStatus,
      luakRepoCommit: input.luakRepoCommit,
      note: null,
      // Not a formality. Bokahli holds no Luak key and cannot verify a Luak
      // signature; asserting anything else here would be Luak vouching for
      // itself in Bokahli's voice.
      verifiedByBokahli: false as const,
    },
    generatedAt: input.now.toISOString(),
    expiresAt: input.expiresAt ?? null,
  };

  return { ok: true, bundle: { ...unhashed, contentHash: bokahliContentHash(unhashed) } };
}

function laneBool(s: ScoredAttempt, ...lanes: string[]): number | null {
  for (const l of lanes) if (s.laneScores[l] !== undefined) return s.laneScores[l] ?? null;
  return null;
}

/**
 * Recompute every aggregate from the attempts being exported.
 *
 * Never copied from a caller-supplied summary. A bundle whose aggregate
 * flatters its attempts is the failure mode where no single field is false and
 * the whole is; recomputing is the only way to be sure the two agree, and
 * Bokahli's importer recomputes them again on arrival.
 */
function recomputeAggregate(
  attempts: readonly Record<string, unknown>[],
  identity: LocalModelIdentity,
): Record<string, unknown> {
  const outcomes = ["PASS", "PARTIAL", "FAIL", "INCOMPLETE", "PROVIDER_FAILURE", "HARNESS_FAILURE"];
  const counts = Object.fromEntries(outcomes.map((o) => [o, 0])) as Record<string, number>;
  for (const a of attempts) counts[a["outcome"] as string] += 1;

  const scores = attempts.map((a) => a["score"]).filter((s): s is number => typeof s === "number");
  const mean = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
  const modelAttr = attempts.filter((a) =>
    ["PASS", "PARTIAL", "FAIL", "INCOMPLETE"].includes(a["outcome"] as string));
  const infra = attempts.filter((a) =>
    ["PROVIDER_FAILURE", "HARNESS_FAILURE"].includes(a["outcome"] as string));

  const schemaChecked = attempts.filter((a) => (a["compliance"] as Record<string, unknown>)["outputSchemaValid"] !== null);
  const citeChecked = attempts.filter((a) => (a["compliance"] as Record<string, unknown>)["citationsValid"] !== null);

  const byFixture = new Map<string, string[]>();
  for (const a of attempts) {
    const f = a["fixtureId"] as string;
    byFixture.set(f, [...(byFixture.get(f) ?? []), a["outcome"] as string]);
  }
  const repeated = [...byFixture.values()].filter((o) => o.length > 1);

  return {
    attemptCount: attempts.length,
    sampleCount: byFixture.size,
    outcomeCounts: counts,
    meanScore: mean,
    passRate: modelAttr.length ? modelAttr.filter((a) => a["outcome"] === "PASS").length / modelAttr.length : null,
    infrastructureFailureRate: attempts.length ? infra.length / attempts.length : null,
    schemaViolationRate: schemaChecked.length
      ? schemaChecked.filter((a) => (a["compliance"] as Record<string, unknown>)["outputSchemaValid"] === false).length / schemaChecked.length
      : null,
    citationViolationRate: citeChecked.length
      ? citeChecked.filter((a) => (a["compliance"] as Record<string, unknown>)["citationsValid"] === false).length / citeChecked.length
      : null,
    scoreStdDev: scores.length && mean !== null
      ? Math.sqrt(scores.reduce((x, y) => x + (y - mean) ** 2, 0) / scores.length)
      : null,
    // Null, not zero: with no repeats, repeatability was never measured, and 0
    // would assert a stability nothing here demonstrates.
    repeatabilityDisagreementRate: repeated.length
      ? repeated.filter((o) => new Set(o).size > 1).length / repeated.length
      : null,
    contextTierTokens: identity.context.effectiveMaxTokens,
    knownFailureModes: [] as string[],
  };
}
