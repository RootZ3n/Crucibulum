/**
 * A campaign cannot claim an evidence boundary it did not invoke.
 *
 * The transport tests prove Luak *sends* untrusted material as evidence. These
 * prove the other half: that a campaign which did not — or which cannot show
 * the deployment agreeing — is refused at export rather than shipped as though
 * it had.
 *
 * This matters because the two are indistinguishable downstream. A bundle from
 * the original campaign and a bundle from the corrected one carry the same
 * fields, the same shapes and the same verdict vocabulary. Nothing about the
 * exported artifact reveals that one of them handed the attacker the caller's
 * authority. So the discrimination has to happen here, at the only point that
 * still has the attempt records.
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import { exportBokahliBundle } from "../core/local/bokahli-export.js";
import { LOCAL_IDENTITY_VERSION } from "../types/local-identity.js";
import { scoreAttempt, type AttemptRecord } from "../core/local/regime.js";

const MODEL = "testmodel.q4-k";
const DIGEST = `sha256:${"a".repeat(64)}`;

type Transport = NonNullable<AttemptRecord["evidenceTransport"]>;

/** A correct campaign's transport block: sent, inspected, fenced, confirmed. */
function transport(over: Partial<Transport> = {}): Transport {
  return {
    transportVersion: "luak.evidence-transport/1",
    packetCount: 1,
    evidenceSetDigest: `sha256:${"1".repeat(64)}`,
    packetIds: ["fx/log"],
    scannedAll: true,
    fencedPacketCount: 1,
    findingsByPacket: [{
      packetId: "fx/log", zone: "evidence",
      findingCount: 0, peakSeverity: null, disposition: "fenced",
    }],
    modelOutputFindingCount: 0,
    boundaryDecision: "allow",
    detectorVersion: "velum.a32-detector/1.0.0+abaiya-velum-mvp-1",
    registryPayloadSha256: `sha256:${"2".repeat(64)}`,
    ...over,
  };
}

function record(over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attemptId: "a1",
    evidenceTransport: transport(),
    fixtureId: "tlt-008-abstention-required",
    suiteId: "local-test-log-triage",
    suiteVersion: "1.0.0",
    split: "evaluation",
    applicability: "APPLICABLE",
    lanes: [{
      lane: "facts",
      scorerVersion: "local-scorers-1.0.0",
      measurements: [{ name: "facts.recall", value: 1, unit: "ratio", detail: "" }],
      failureCodes: [],
      attribution: "MODEL",
      notes: [],
    }],
    contextPosition: null,
    contextTier: "control",
    promptTokens: 100,
    completionTokens: 20,
    tokenCountSource: "runtime_tokenizer",
    timeToFirstTokenMs: 200,
    decodeTokensPerSecond: 60,
    wallTimeMs: 900,
    seed: 1,
    ...over,
  };
}

function identity() {
  return {
    identityVersion: LOCAL_IDENTITY_VERSION,
    artifact: {
      modelId: MODEL, artifactDigest: DIGEST, quantization: "Q4_K", format: "gguf",
      sizeBytes: 1, parameterCount: 1, activeParameterCount: null,
    },
    runtime: { name: "llama.cpp", build: "b1-test", binaryDigest: null, apiFlavour: "openai-compatible" },
    promptTemplate: {
      templateId: "peg-native", templateDigest: `sha256:${"a4".repeat(32)}`,
      appliedBy: "runtime", bosTokenId: null, eosTokenId: null,
    },
    sampler: { temperature: 0, topP: 1, topK: null, repeatPenalty: null, seed: null, seedHonoured: null },
    hardware: {
      profileId: "mushin", gpuModel: null, gpuMemoryMiB: null, gpuDriver: null,
      cudaVersion: null, cpuModel: null, systemMemoryMiB: null,
    },
    placement: {
      requestedGpuLayers: null, observedGpuLayers: null, cpuOffloadEnabled: null,
      observedVramBytes: null, observedHostRamBytes: null, gpuConfirmed: null,
    },
    context: {
      configuredTokens: 32768, effectiveMaxTokens: 8000,
      tierLabel: "control", tokenCountSource: "runtime_tokenizer",
    },
    concurrency: { slots: 1, maxConcurrentRequests: 1, batchSize: null },
    fixtureSuiteId: "local-test-log-triage",
    fixtureSuiteVersion: "1.0.0",
    verificationRegimeVersion: "local-regime-1.1.0",
  };
}

function exportOf(records: readonly AttemptRecord[]) {
  return exportBokahliBundle({
    taskClass: "test_log_triage",
    taskClassContractVersion: "1.0.0",
    identity: identity() as unknown as Parameters<typeof exportBokahliBundle>[0]["identity"],
    records,
    scored: records.map(scoreAttempt),
    luakBundleIds: records.map((r) => r.attemptId),
    luakBundleHashes: [],
    luakSignatureStatus: null,
    luakRepoCommit: null,
    now: new Date("2026-08-21T12:00:00Z"),
  });
}

const codesOf = (r: ReturnType<typeof exportOf>): string[] =>
  r.ok ? [] : r.refusals.map((x) => x.code);

// ─── the baseline must actually export ──────────────────────────────────────

test("a correct campaign exports", () => {
  const r = exportOf([
    record({ attemptId: "a1" }),
    record({ attemptId: "a2", fixtureId: "tlt-009-injection-in-log" }),
  ]);
  assert.equal(r.ok, true, `baseline should export, refusals: ${codesOf(r).join(", ")}`);
});

// ─── legacy and mixed campaigns are refused ─────────────────────────────────

test("a campaign with no evidence transport at all is refused as legacy", () => {
  const r = exportOf([
    record({ attemptId: "a1", evidenceTransport: null }),
    record({ attemptId: "a2", evidenceTransport: null, fixtureId: "tlt-009-injection-in-log" }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("LEGACY_EVIDENCE_TRANSPORT"),
    `expected LEGACY_EVIDENCE_TRANSPORT, got ${codesOf(r).join(", ")}`);
  const detail = r.ok ? "" : r.refusals.find((x) => x.code === "LEGACY_EVIDENCE_TRANSPORT")!.detail;
  assert.match(detail, /cannot be repaired by re-exporting/,
    "the refusal must say re-running is the only fix, not re-exporting");
});

test("mixing corrected and legacy attempts is refused", () => {
  const r = exportOf([
    record({ attemptId: "a1" }),
    record({ attemptId: "a2", evidenceTransport: null, fixtureId: "tlt-009-injection-in-log" }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("MIXED_EVIDENCE_TRANSPORT"));
});

test("mixing transport versions is refused", () => {
  const r = exportOf([
    record({ attemptId: "a1" }),
    record({
      attemptId: "a2", fixtureId: "tlt-009-injection-in-log",
      evidenceTransport: transport({ transportVersion: "luak.evidence-transport/0" }),
    }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("MIXED_EVIDENCE_TRANSPORT_VERSION"));
});

// ─── a stripped or malformed evidence set is refused ────────────────────────

test("a stripped evidence[] fails campaign validity", () => {
  const r = exportOf([
    record({ attemptId: "a1", evidenceTransport: transport({ packetCount: 0, packetIds: [], fencedPacketCount: 0 }) }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_TRANSPORT_EMPTY"),
    `expected EVIDENCE_TRANSPORT_EMPTY, got ${codesOf(r).join(", ")}`);
});

test("a duplicated packet cannot substitute for another", () => {
  const r = exportOf([
    record({
      attemptId: "a1",
      evidenceTransport: transport({ packetCount: 2, packetIds: ["fx/log", "fx/log"], fencedPacketCount: 2 }),
    }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_TRANSPORT_DUPLICATE_PACKET"));
});

test("a packet count that disagrees with the packet ids is refused", () => {
  const r = exportOf([
    record({ attemptId: "a1", evidenceTransport: transport({ packetCount: 3 }) }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_TRANSPORT_INCONSISTENT"));
});

// ─── the deployment must confirm, not merely be intended ────────────────────

test("a campaign the boundary never confirmed is refused", () => {
  // Luak intending to use the evidence channel is not proof the deployment
  // inspected anything. Null telemetry is silence, not a clean bill of health.
  const r = exportOf([
    record({ attemptId: "a1", evidenceTransport: transport({ scannedAll: null, boundaryDecision: null }) }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_TRANSPORT_UNCONFIRMED"));
});

test("a deployment that did not scan every packet is refused", () => {
  const r = exportOf([
    record({ attemptId: "a1", evidenceTransport: transport({ scannedAll: false }) }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_TRANSPORT_UNSCANNED"));
});

test("evidence that reached the model unfenced is refused", () => {
  // This is the original defect's signature, seen from the other side: packets
  // were sent, the boundary looked at them, and it fenced none — meaning they
  // carried the same standing as the caller's own instruction.
  const r = exportOf([
    record({
      attemptId: "a1",
      evidenceTransport: transport({
        fencedPacketCount: 0,
        findingsByPacket: [{
          packetId: "fx/log", zone: "client-instruction",
          findingCount: 1, peakSeverity: "review", disposition: "passed",
        }],
      }),
    }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("EVIDENCE_NOT_FENCED"),
    `expected EVIDENCE_NOT_FENCED, got ${codesOf(r).join(", ")}`);
});

test("a detector miss is still a valid campaign, provided the packet was fenced", () => {
  // Zero findings is not a failure. Fencing is structural: material the
  // detector did not recognise is still untrusted material, and an attempt
  // where it was fenced is a measurement of the model, not of the detector.
  const r = exportOf([
    record({
      attemptId: "a1",
      evidenceTransport: transport({
        findingsByPacket: [{
          packetId: "fx/log", zone: "evidence",
          findingCount: 0, peakSeverity: null, disposition: "fenced",
        }],
      }),
    }),
  ]);
  assert.equal(r.ok, true, `a fenced miss must export, refusals: ${codesOf(r).join(", ")}`);
});

test("attempts from different detectors are not one measurement", () => {
  const r = exportOf([
    record({ attemptId: "a1" }),
    record({
      attemptId: "a2", fixtureId: "tlt-009-injection-in-log",
      evidenceTransport: transport({ registryPayloadSha256: `sha256:${"9".repeat(64)}` }),
    }),
  ]);
  assert.equal(r.ok, false);
  assert.ok(codesOf(r).includes("MIXED_DETECTOR"));
});

// ─── provenance distinguishes the campaigns downstream ──────────────────────

test("the exported provenance names the transport, so Bokahli can tell them apart", () => {
  const r = exportOf([record({ attemptId: "a1" }), record({ attemptId: "a2", fixtureId: "tlt-009-injection-in-log" })]);
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  const src = String(r.bundle.provenance["sourceContractVersion"]);
  assert.match(src, /local-regime-1\.1\.0/);
  assert.match(src, /luak\.bokahli-exporter-2\.1\.0/);
  assert.match(src, /luak\.evidence-transport\/1/);
  // And it still claims no trust of any kind.
  assert.equal(r.bundle.provenance["verifiedByBokahli"], false);
  assert.ok(!JSON.stringify(r.bundle).includes("importTrust"),
    "the exporter must not emit an import-trust field");
});
