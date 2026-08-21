/**
 * Bokahli's trust-boundary telemetry is additive, and its outcomes are mapped.
 *
 * Bokahli a4aac8d publishes `telemetry.velum` — what its prompt-injection
 * boundary found, decided and did — alongside every B2 field. Luak does not
 * read it and must not start: token provenance is derived from proofs about the
 * tokenizer, and a detector's opinion about a document is not one of them.
 *
 * What Luak *does* need is for the new field to change nothing, and for the
 * eight new typed outcomes to be classified rather than falling through as
 * unmapped harness failures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveTokenProvenance } from "../core/local/responders/bokahli-provenance.js";
import {
  ESCALATE_MAP, CAPACITY_MAP, lookupOutcome, anyModelAttributed,
  BOKAHLI_FAILURE_MAP_VERSION,
} from "../core/local/responders/bokahli-failure-map.js";

const MODEL = "qwen3.5-35b-a3b.q2-k";
const DIGEST = `sha256:${"49".repeat(32)}`;
const INSTANCE = "inst-abc";

/** A Velum block exactly as Bokahli emits one. */
const VELUM = {
  boundaryVersion: "bokahli.velum-boundary/1",
  detectorVersion: "velum.a32-detector/1.0.0+abaiya-velum-mvp-1",
  registryVersion: "abaiya-velum-mvp-1",
  registryPayloadSha256: "ecb27b1c9bd52d03964c099328ce78bb4d96699f8a7c90196be548a104308f0d",
  fenceVersion: "velum.fence.a32-1",
  normalizationVersion: "velum.normalize.a32-1",
  mode: "enforce",
  packets: [{
    id: "notes.md", zone: "evidence", scanned: true,
    rawContentSha256: `sha256:${"11".repeat(32)}`,
    renderedContentSha256: `sha256:${"22".repeat(32)}`,
    findingCount: 1,
    categories: ["prompt-injection"], severities: ["review"], peakSeverity: "review",
    findings: [{
      patternId: "ignore_instructions", contentSha256: `sha256:${"11".repeat(32)}`,
      category: "prompt-injection", severity: "review",
      sourceSpan: { startByte: 34, endByte: 66 },
      spanAbsentReason: null, fidelity: "exact", derivedFrom: null,
    }],
    decision: "review", disposition: "fenced",
    rationale: "enforce mode: prompt-injection at severity review in a evidence zone",
  }],
  decision: "review", clean: false, scannedAll: true, steps: 918_244,
  receipt: "velum ... mode=enforce packets=1 decision=review clean=false",
};

function b2Body(bend: (b: Record<string, any>) => void = () => {}): Record<string, unknown> {
  const body: Record<string, any> = {
    requestId: "req-1", outcome: "ROUTED", route: { kind: "ROUTED", mode: "EXACT" },
    result: {
      content: '{"outcome":"ABSTAINED"}', finishReason: "stop",
      servedIdentity: {
        modelId: MODEL, digest: DIGEST,
        runtime: {
          engine: "llama.cpp", build: "b10505-ee4c505a4",
          executableDigest: `sha256:${"e".repeat(64)}`, cuda: "13.2.51", driver: "595.91.07",
        },
        servedContextTokens: 32768, attested: true, attestationMethod: "backend-props-match",
        qualificationFacts: {
          contractVersion: "bokahli.qualification-telemetry.v1",
          runtime: {
            provenance: "observed", engine: "llama.cpp", build: "b10505-ee4c505a4",
            imageDigest: `sha256:${"e".repeat(64)}`, imageDigestBinding: "configured-tree",
            imageDigestAlgorithm: "bokahli.runtime-image.v2",
            imageComponents: ["llama-server"], driverVersion: "595.91.07",
            driverSupportedCuda: "13.2", processCudaRuntime: "13.2.51",
            cublasVersion: null, limitation: null,
          },
          tokenizer: {
            provenance: "observed", family: "gpt2", pretokenizer: "qwen35",
            vocabSize: 248320, runtimeVocabSize: 248320, vocabSizeMatch: true,
            metadataDigest: `sha256:${"1f".repeat(32)}`, metadataBound: true,
            decodeCanaryVerified: true, encodeCanaryVerified: true, pretokenizerVerified: true,
            canarySuiteId: "qwen35-broad.v1", canarySuiteHash: `sha256:${"03".repeat(32)}`,
            verifiedBackendInstanceId: INSTANCE, verifiedAt: "2026-08-20T12:00:00.000Z",
            tokenizedBy: "runtime", runtimeBuild: "b10505-ee4c505a4", unprovenReasons: [],
            runtimeProof: { method: "runtime-canary-probe", matches: true, canary: { coverageNote: "x" } },
          },
          template: {
            requested: null,
            configured: {
              provenance: "runtime-reported", appliedBy: "runtime", templateId: "peg-native",
              templateDigest: `sha256:${"a4".repeat(32)}`, reasoningFormat: "deepseek",
              matchesArtifactTemplate: true, applied: null,
            },
            effective: { provenance: "runtime-reported", appliedBy: "runtime", templateId: "peg-native", applied: null },
            requestConfirmed: null, mismatch: null, reasoningFormatOverridden: true,
          },
          backendInstance: {
            provenance: "observed", pid: 20348, bootId: null, kernelStartTicks: 132307,
            startedAt: "2026-08-20T11:00:00.000Z", instanceId: INSTANCE, unprovenReasons: [],
          },
          placement: {
            provenance: "observed", method: "nvidia-smi-compute-apps", backendPid: 20348,
            backendHoldsDevice: true, backendVramMiB: 2434, floorMiB: 512,
            requestedGpuLayers: 999, cpuOffloadEnabled: true, limitation: null,
          },
          attestation: {
            binding: {}, bindingDigest: `sha256:${"bb".repeat(32)}`, completeness: "partial",
            missing: [], observedAt: "2026-08-20T12:00:00.000Z", generation: 3,
            expiresAt: "2026-08-20T12:01:00.000Z", backendInstanceId: INSTANCE,
          },
        },
      },
    },
    telemetry: {
      requestId: "req-1", promptTokens: 189, completionTokens: 68,
      timeToFirstTokenMs: 170, totalMs: 1200, completionTokensPerSecond: 64,
      runtimeBuild: "b10505-ee4c505a4",
      tokenCounts: {
        source: "runtime_tokenizer", promptTokens: 189, completionTokens: 68,
        promptTokenSource: "runtime_tokenizer", completionTokenSource: "runtime_tokenizer",
      },
      sampler: {
        requested: { temperature: 0 }, sent: { temperature: 0 }, effective: { temperature: 0 },
        effectiveSource: "runtime-slots-uncorrelated", effectiveScope: "backend-instance",
        seedSupport: "requested", deterministicOutputGuaranteed: false,
      },
      attemptLifetime: {
        admittedAt: "2026-08-20T12:00:00.000Z", completedAt: "2026-08-20T12:00:30.000Z",
        attestationObservedAt: "2026-08-20T12:00:00.000Z",
        attestationExpiresAt: "2026-08-20T12:01:00.000Z",
        instanceAtAdmission: INSTANCE, instanceAtCompletion: INSTANCE,
        attestationValidAtAdmission: true, crossedAttestationTtl: false,
        instanceContinuous: true, revalidation: "none", verdict: "valid", reasons: [],
      },
    },
  };
  bend(body);
  return body;
}

const derive = (body: unknown) =>
  deriveTokenProvenance({
    body, expectedModelId: MODEL, expectedArtifactDigest: DIGEST,
    expectedContractVersion: "bokahli.qualification-telemetry.v1",
    protocolGeneration: "b2",
  });

test("a Velum-bearing response derives identically to one without", () => {
  const without = derive(b2Body());
  const with_ = derive(b2Body((b) => { b.telemetry.velum = VELUM; }));
  assert.equal(with_.source, "runtime_tokenizer");
  assert.deepEqual(with_.unmet, []);
  assert.equal(JSON.stringify(without), JSON.stringify(with_), "byte-identical");
});

test("no Velum field can restore a proof the response does not carry", () => {
  // The attack: strip a real proof, then assert it from inside the new block.
  const stripped = derive(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
  }));
  const smuggled = derive(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
    b.telemetry.velum = {
      ...VELUM,
      tokenizer: { encodeCanaryVerified: true, decodeCanaryVerified: true, provenance: "observed" },
      qualification: { status: "QUALIFIED", authority: "luak" },
      trusted: true,
      attemptLifetime: { verdict: "valid" },
    };
  }));
  assert.notEqual(stripped.source, "runtime_tokenizer");
  assert.equal(JSON.stringify(smuggled), JSON.stringify(stripped));
});

test("every trust-boundary outcome is classified, and none blames the model", () => {
  const escalations = [
    "VELUM_EVIDENCE_BLOCKED", "VELUM_RESOURCE_LIMIT", "VELUM_MAPPING_FAILURE",
    "VELUM_ENGINE_ERROR", "VELUM_SCAN_TIMEOUT", "VELUM_WORKER_LOST", "HOST_INTEGRITY_FAULT",
  ];
  assert.equal(escalations.length, 7);
  for (const reason of escalations) {
    const m = lookupOutcome("ESCALATE", reason);
    assert.ok(m, `${reason} is unmapped`);
    assert.notEqual(m?.attribution, "MODEL");
    assert.ok((m?.why.length ?? 0) > 40, `${reason} must justify itself`);
  }
  const cap = lookupOutcome("CAPACITY_UNAVAILABLE", "VELUM_SCAN_CAPACITY");
  assert.ok(cap);
  assert.notEqual(cap?.attribution, "MODEL");
  assert.equal(anyModelAttributed().length, 0);
  assert.equal(BOKAHLI_FAILURE_MAP_VERSION, "bokahli-failure-map-1.3.0");
});

test("a host-integrity fault is not transient, and stops rather than retries", () => {
  // The one entry that deliberately does not mirror Bokahli's retry hint. The
  // fault is intermittent, so retrying samples a machine known to compute wrong
  // answers until one of them looks right.
  const m = lookupOutcome("ESCALATE", "HOST_INTEGRITY_FAULT");
  assert.equal(m?.transient, false);
  assert.match(m?.why ?? "", /machine/);
  assert.ok(!/qualif/i.test(m?.why ?? ""), "it makes no claim about qualification");
});

test("an unknown variant still fails closed", () => {
  // The pin advanced; the fall-through did not change.
  assert.equal(lookupOutcome("ESCALATE", "SOMETHING_INVENTED_LATER"), null);
  assert.equal(lookupOutcome("CAPACITY_UNAVAILABLE", "ALSO_INVENTED"), null);
  assert.ok(!Object.keys(ESCALATE_MAP).includes("SOMETHING_INVENTED_LATER"));
  assert.ok(!Object.keys(CAPACITY_MAP).includes("ALSO_INVENTED"));
});
