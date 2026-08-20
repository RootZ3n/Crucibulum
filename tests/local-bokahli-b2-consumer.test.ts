/**
 * Luak — consuming Bokahli B2 without believing it.
 *
 * The responder used to answer `runtime_reported_unknown_tokenizer` from a
 * constant, which was correct and unfalsifiable. B2 publishes a proof, so the
 * verdict is derived — and a derived verdict is only as good as its refusals.
 * Every test here hands the responder a response that *looks* exportable and
 * checks that it is not, or hands it a legacy response and checks that nothing
 * crashes and nothing is claimed.
 *
 * Fixtures are shaped by Bokahli's pinned contract in `types/bokahli-contract`,
 * generated verbatim from the published commit. Nothing here is a
 * hand-maintained lookalike, and no request reaches the live deployment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The tests run compiled, from `dist/tests`, with the repo root as cwd. */
const ROOT = process.cwd();
import { deriveTokenProvenance } from "../core/local/responders/bokahli-provenance.js";
import {
  extractB2Facts, refusesCanonicalAttempt,
} from "../core/local/responders/bokahli-b2-facts.js";
import { lookupOutcome } from "../core/local/responders/bokahli-failure-map.js";
import { ESCALATE_MAP, REFUSED_MAP, CAPACITY_MAP }
  from "../core/local/responders/bokahli-failure-map.js";

const MODEL = "qwen3.5-35b-a3b.q2-k";
const DIGEST = `sha256:${"49".repeat(32)}`;
const INSTANCE = "inst-abc";

/** A fully proven B2 response, as Bokahli emits one. Bent one field at a time. */
function b2Body(bend: (b: Record<string, any>) => void = () => {}): Record<string, unknown> {
  const body: Record<string, any> = {
    requestId: "req-1",
    outcome: "ROUTED",
    route: { kind: "ROUTED", mode: "EXACT" },
    result: {
      content: '{"outcome":"ABSTAINED"}',
      finishReason: "stop",
      servedIdentity: {
        modelId: MODEL,
        digest: DIGEST,
        runtime: {
          engine: "llama.cpp", build: "b10505-ee4c505a4",
          executableDigest: `sha256:${"e".repeat(64)}`, cuda: "13.2.51", driver: "595.91.07",
        },
        servedContextTokens: 32768,
        attested: true,
        attestationMethod: "backend-props-match",
        qualificationFacts: {
          contractVersion: "bokahli.qualification-telemetry.v1",
          runtime: {
            provenance: "observed", engine: "llama.cpp", build: "b10505-ee4c505a4",
            imageDigest: `sha256:${"e".repeat(64)}`,
            imageDigestBinding: "configured-tree",
            imageDigestAlgorithm: "bokahli.runtime-image.v2",
            imageComponents: ["llama-server", "libllama.so.0.1.2"],
            driverVersion: "595.91.07", driverSupportedCuda: "13.2",
            processCudaRuntime: "13.2.51", cublasVersion: null, limitation: null,
          },
          tokenizer: {
            provenance: "observed", family: "gpt2", pretokenizer: "qwen35",
            vocabSize: 248320, runtimeVocabSize: 248320, vocabSizeMatch: true,
            metadataDigest: `sha256:${"1f".repeat(32)}`,
            metadataBound: true,
            decodeCanaryVerified: true,
            encodeCanaryVerified: true,
            pretokenizerVerified: true,
            canarySuiteId: "qwen35-broad.v1",
            canarySuiteHash: `sha256:${"03".repeat(32)}`,
            verifiedBackendInstanceId: INSTANCE,
            verifiedAt: "2026-08-20T12:00:00.000Z",
            tokenizedBy: "runtime", runtimeBuild: "b10505-ee4c505a4",
            unprovenReasons: [],
            runtimeProof: {
              method: "runtime-canary-probe", matches: true,
              canary: { coverageNote: "Behavioural canary coverage over a fixed corpus." },
            },
          },
          template: {
            requested: null,
            configured: {
              provenance: "runtime-reported", appliedBy: "runtime", templateId: "peg-native",
              templateDigest: `sha256:${"a4".repeat(32)}`, reasoningFormat: "deepseek",
              matchesArtifactTemplate: true, applied: null,
            },
            effective: {
              provenance: "runtime-reported", appliedBy: "runtime", templateId: "peg-native",
              applied: null,
            },
            requestConfirmed: null,
            mismatch: null,
            reasoningFormatOverridden: true,
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
            binding: {}, bindingDigest: `sha256:${"bb".repeat(32)}`,
            completeness: "partial",
            missing: ["runtime.imageDigestBinding=configured-tree"],
            observedAt: "2026-08-20T12:00:00.000Z",
            generation: 3,
            expiresAt: "2026-08-20T12:01:00.000Z",
            backendInstanceId: INSTANCE,
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
        requested: { temperature: 0 }, sent: { temperature: 0, topP: 0.95, maxTokens: 512 },
        effective: { temperature: 0 },
        effectiveSource: "runtime-slots-uncorrelated",
        effectiveScope: "backend-instance",
        seedSupport: "requested",
        deterministicOutputGuaranteed: false,
      },
      attemptLifetime: {
        admittedAt: "2026-08-20T12:00:00.000Z",
        completedAt: "2026-08-20T12:00:30.000Z",
        attestationObservedAt: "2026-08-20T12:00:00.000Z",
        attestationExpiresAt: "2026-08-20T12:01:00.000Z",
        instanceAtAdmission: INSTANCE,
        instanceAtCompletion: INSTANCE,
        attestationValidAtAdmission: true,
        crossedAttestationTtl: false,
        instanceContinuous: true,
        revalidation: "none",
        verdict: "valid",
        reasons: [],
      },
    },
  };
  bend(body);
  return body;
}

const derive = (body: unknown) =>
  deriveTokenProvenance({ body, expectedModelId: MODEL, expectedArtifactDigest: DIGEST });

// ---------------------------------------------------------------------------
// the happy path exists, so the refusals below mean something
// ---------------------------------------------------------------------------

test("a fully proven B2 response yields runtime_tokenizer", () => {
  const v = derive(b2Body());
  assert.deepEqual(v.unmet, []);
  assert.equal(v.source, "runtime_tokenizer");
  assert.equal(v.canarySuiteId, "qwen35-broad.v1");
  assert.equal(v.proof.encodeCanaryVerified, true);
  assert.equal(v.proof.decodeCanaryVerified, true);
});

// ---------------------------------------------------------------------------
// a field must not be able to promote itself
// ---------------------------------------------------------------------------

test("a response that self-labels runtime_tokenizer without the proof object is refused", () => {
  // The attack this whole module exists for. `tokenCounts.source` is a string
  // in a JSON body; a bug, a proxy, a replayed capture, or someone trying to
  // turn a red campaign green can set it. It is one vote out of eleven.
  const bare: Record<string, unknown> = {
    result: {
      servedIdentity: {
        modelId: MODEL, digest: DIGEST, attested: true,
        qualificationFacts: { contractVersion: "bokahli.qualification-telemetry.v1" },
      },
    },
    telemetry: {
      promptTokens: 189, completionTokens: 68,
      tokenCounts: { source: "runtime_tokenizer" },
    },
  };
  const v = derive(bare);
  assert.notEqual(v.source, "runtime_tokenizer");
  assert.equal(v.declaredSource, "runtime_tokenizer", "and Bokahli's claim is still recorded");
  assert.ok(v.unmet.length >= 5, `expected several unmet proofs, got ${v.unmet.join("; ")}`);
});

test("every single proof is load-bearing on its own", () => {
  const bends: Record<string, (b: Record<string, any>) => void> = {
    "wrong model id": (b) => { b.result.servedIdentity.modelId = "other-model"; },
    "wrong digest": (b) => { b.result.servedIdentity.digest = `sha256:${"0".repeat(64)}`; },
    "not attested": (b) => { b.result.servedIdentity.attested = false; },
    "unattested completeness": (b) => {
      b.result.servedIdentity.qualificationFacts.attestation.completeness = "unattested";
    },
    "metadata not bound": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.metadataBound = false;
    },
    "encode canary absent": (b) => {
      delete b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified;
    },
    "encode canary false": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
    },
    "decode canary false": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.decodeCanaryVerified = false;
    },
    "no canary suite id": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.canarySuiteId = null;
    },
    "no canary suite hash": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.canarySuiteHash = null;
    },
    "canary from another instance": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.verifiedBackendInstanceId = "inst-other";
    },
    "no backend instance": (b) => {
      b.result.servedIdentity.qualificationFacts.backendInstance.instanceId = null;
    },
    "attestation names another instance": (b) => {
      b.result.servedIdentity.qualificationFacts.attestation.backendInstanceId = "inst-other";
    },
    "counts absent": (b) => {
      b.telemetry.promptTokens = null; b.telemetry.completionTokens = null;
    },
    "bokahli says unknown tokenizer": (b) => {
      b.telemetry.tokenCounts.source = "runtime_reported_unknown_tokenizer";
    },
    "admitted on lapsed evidence": (b) => {
      b.telemetry.attemptLifetime.attestationValidAtAdmission = false;
    },
    "instance not continuous": (b) => {
      b.telemetry.attemptLifetime.instanceContinuous = false;
    },
    "lifetime verdict invalid": (b) => {
      b.telemetry.attemptLifetime.verdict = "infrastructure-invalid";
    },
    "lifetime record absent": (b) => { delete b.telemetry.attemptLifetime; },
    "truthy but not true": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = "yes";
    },
  };
  for (const [what, bend] of Object.entries(bends)) {
    const v = derive(b2Body(bend));
    assert.notEqual(v.source, "runtime_tokenizer", `${what} must block export`);
    assert.ok(v.unmet.length > 0, `${what} must say why`);
  }
});

test("encode-only and decode-only proofs are both refused", () => {
  const encodeOnly = derive(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.decodeCanaryVerified = false;
  }));
  const decodeOnly = derive(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
  }));
  assert.equal(encodeOnly.source, "runtime_reported_unknown_tokenizer");
  assert.equal(decodeOnly.source, "runtime_reported_unknown_tokenizer");
  assert.match(decodeOnly.unmet.join(" "), /encode canary/);
});

test("counts that are absent are unknown, not merely unprovenanced", () => {
  // Different downstream meanings: one is a missing measurement, the other is
  // a measurement nobody can attribute.
  const v = derive(b2Body((b) => {
    b.telemetry.promptTokens = null;
    b.telemetry.completionTokens = null;
  }));
  assert.equal(v.source, "unknown");
});

// ---------------------------------------------------------------------------
// canonical attempt creation
// ---------------------------------------------------------------------------

test("an unattested completion carrying otherwise valid output is not an attempt", () => {
  const f = extractB2Facts(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.attestation.completeness = "unattested";
  }));
  const r = refusesCanonicalAttempt(f, true);
  assert.equal(r.refuse, true);
  assert.match(r.reasons.join(" "), /unattested/);
});

test("the same pid with a different instance identity is a different process", () => {
  // A restart can reuse a pid. Identity, not the pid, is what has to agree —
  // and this check is made independently of Bokahli's own verdict so a bug
  // upstream cannot wave it through.
  const f = extractB2Facts(b2Body((b) => {
    b.telemetry.attemptLifetime.instanceAtCompletion = "inst-after-restart";
    b.telemetry.attemptLifetime.instanceContinuous = true;   // upstream says fine
    b.telemetry.attemptLifetime.verdict = "valid";           // upstream says fine
  }));
  const r = refusesCanonicalAttempt(f, true);
  assert.equal(r.refuse, true);
  assert.match(r.reasons.join(" "), /different processes/);
});

test("unknown continuity refuses a canonical attempt", () => {
  const f = extractB2Facts(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.backendInstance.instanceId = null;
  }));
  assert.equal(refusesCanonicalAttempt(f, true).refuse, true);
});

test("an infrastructure-invalid verdict refuses a canonical attempt", () => {
  const f = extractB2Facts(b2Body((b) => {
    b.telemetry.attemptLifetime.verdict = "infrastructure-invalid";
  }));
  assert.equal(refusesCanonicalAttempt(f, true).refuse, true);
});

test("a healthy B2 response is allowed to become an attempt", () => {
  assert.equal(refusesCanonicalAttempt(extractB2Facts(b2Body()), true).refuse, false);
});

// ---------------------------------------------------------------------------
// tiers that must not be flattened
// ---------------------------------------------------------------------------

test("uncorrelated template and sampler facts are not presented as request-confirmed", () => {
  const f = extractB2Facts(b2Body());
  assert.equal(f.template.requestConfirmed, false, "Bokahli confirms no template for a request");
  assert.equal(f.template.configuredApplied, null, "holding a template is not applying one");
  assert.equal(f.template.matchesArtifactTemplate, true, "and that claim is separately true");
  assert.equal(f.template.reasoningFormatOverridden, true);
  assert.equal(f.sampler.effectiveScope, "backend-instance");
  assert.equal(f.sampler.effectiveSource, "runtime-slots-uncorrelated");
  assert.equal(f.sampler.seedSupport, "requested");
  assert.equal(f.sampler.deterministicOutputGuaranteed, false);
});

test("an unknown seed or sampler does not by itself block the token-count claim", () => {
  // Repeatability analysis, not an export gate. The qualification regime may
  // demand more; the responder does not invent that demand.
  const v = derive(b2Body((b) => {
    b.telemetry.sampler.seedSupport = "not_requested";
    delete b.telemetry.sampler.effective;
  }));
  assert.equal(v.source, "runtime_tokenizer");
});

test("configured-tree image identity is never relabelled process-observed", () => {
  const configured = extractB2Facts(b2Body());
  assert.equal(configured.placement.imageDigestBinding, "configured-tree");
  assert.equal(configured.imageDigestIsProcessObserved, false,
    "a digest being present proves a digest was computed, not what it covers");
  const mapped = extractB2Facts(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.runtime.imageDigestBinding = "process-mapped";
  }));
  assert.equal(mapped.imageDigestIsProcessObserved, true);
  // And an unrecognised binding is not promoted either.
  const odd = extractB2Facts(b2Body((b) => {
    b.result.servedIdentity.qualificationFacts.runtime.imageDigestBinding = "process-mapped-ish";
  }));
  assert.equal(odd.imageDigestIsProcessObserved, false);
});

test("backend identity, placement and attestation are recorded in full", () => {
  const f = extractB2Facts(b2Body());
  assert.equal(f.instance.backendInstanceId, INSTANCE);
  assert.equal(f.instance.admissionInstanceId, INSTANCE);
  assert.equal(f.instance.terminalInstanceId, INSTANCE);
  assert.equal(f.instance.continuityVerdict, "valid");
  assert.equal(f.instance.attestationGeneration, 3);
  assert.equal(f.instance.attestationExpiresAt, "2026-08-20T12:01:00.000Z");
  assert.equal(f.instance.attestationCompleteness, "partial");
  assert.deepEqual(f.instance.attestationMissing, ["runtime.imageDigestBinding=configured-tree"]);
  assert.equal(f.placement.backendHoldsDevice, true);
  assert.equal(f.placement.floorMiB, 512);
  assert.equal(f.placement.imageDigestAlgorithm, "bokahli.runtime-image.v2");
  assert.equal(f.tokenizer.canaryCoverageNote?.includes("Behavioural canary"), true,
    "the bound on the claim travels with the claim");
});

// ---------------------------------------------------------------------------
// compatibility in both directions
// ---------------------------------------------------------------------------

test("a Phase 1 response parses without crashing and claims nothing", () => {
  const legacy = {
    result: {
      servedIdentity: {
        modelId: MODEL, digest: DIGEST, attested: true,
        runtime: { engine: "llama.cpp", build: "b10505-ee4c505a4" },
      },
    },
    telemetry: { promptTokens: 120, completionTokens: 18 },
  };
  const f = extractB2Facts(legacy);
  assert.equal(f.publishesB2Contract, false);
  assert.equal(f.tokenizer.encodeCanaryVerified, null, "absent is null, never false");
  assert.equal(refusesCanonicalAttempt(f, true).refuse, false,
    "a legacy response cannot fail checks its contract never had");
  assert.equal(derive(legacy).source, "runtime_reported_unknown_tokenizer");
});

test("hostile shapes do not crash the reader", () => {
  for (const body of [
    null, undefined, 0, "", [], {},
    { result: "not-an-object" },
    { result: { servedIdentity: [] } },
    { telemetry: { attemptLifetime: "yes" } },
    { result: { servedIdentity: { qualificationFacts: { tokenizer: 5 } } } },
    { telemetry: { tokenCounts: { source: 42 } } },
  ]) {
    const f = extractB2Facts(body);
    assert.equal(typeof f.publishesB2Contract, "boolean");
    const v = derive(body);
    assert.notEqual(v.source, "runtime_tokenizer");
  }
});

test("the pinned Bokahli contract is intact and is the published one", async () => {
  // Runs the same check CI runs, as a process, so the test cannot pass while
  // the command it stands for is broken.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const script = join(ROOT, "scripts", "sync-bokahli-contract.mjs");
  await run("node", [script]);  // rejects on a non-zero exit

  const lockPath = join(ROOT, "types", "bokahli-contract", "contract.lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf-8")) as {
    pinnedCommit: string; publishedBranch: string; files: Record<string, unknown>;
  };
  assert.match(lock.pinnedCommit, /^[0-9a-f]{40}$/);
  assert.equal(lock.publishedBranch, "origin/v2");
  assert.ok(Object.keys(lock.files).length >= 5, "the whole contract is pinned, not a slice");
});

test("every reason variant the published contract declares is mapped", async () => {
  // Read from the pinned contract source rather than a hand-kept list, so a new
  // reason upstream becomes a failure here instead of a silent default.
  const routingPath = join(ROOT, "types", "bokahli-contract", "routing.ts");
  const src = await readFile(routingPath, "utf-8");
  const union = (name: string): readonly string[] => {
    const start = src.indexOf(`export type ${name} =`);
    assert.ok(start >= 0, `${name} not found in the pinned contract`);
    // Comments are stripped before looking for the terminating semicolon.
    // Bokahli documents each member in prose, and its prose contains
    // semicolons — scanning the raw text truncated the union after the first
    // one and made a mapped reason look undeclared.
    const tail = src.slice(start);
    const nextDecl = tail.indexOf("\nexport ", 1);
    const region = (nextDecl > 0 ? tail.slice(0, nextDecl) : tail)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const end = region.indexOf(";");
    assert.ok(end > 0, `${name} union has no terminator`);
    return [...region.slice(0, end).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] as string);
  };
  const published = {
    ESCALATE: union("EscalateReason"),
    REFUSED: union("RefusalReason"),
    CAPACITY_UNAVAILABLE: union("CapacityReason"),
  } as const;
  for (const [kind, reasons] of Object.entries(published)) {
    assert.ok(reasons.length > 0, `${kind} union parsed empty`);
    for (const reason of reasons) {
      assert.ok(lookupOutcome(kind as "ESCALATE", reason), `${kind}/${reason} is unmapped`);
    }
  }
  // And nothing is mapped that the contract does not declare: a stale entry is
  // a claim about an outcome that can no longer happen.
  for (const [kind, map] of [["ESCALATE", ESCALATE_MAP], ["REFUSED", REFUSED_MAP],
    ["CAPACITY_UNAVAILABLE", CAPACITY_MAP]] as const) {
    for (const reason of Object.keys(map)) {
      assert.ok(
        (published[kind] as readonly string[]).includes(reason),
        `${kind}/${reason} is mapped but no longer declared by the contract`,
      );
    }
  }
  assert.ok(published.ESCALATE.includes("ATTESTATION_STALE"));
  assert.ok(published.ESCALATE.includes("ATTEMPT_NOT_ATTRIBUTABLE"));
});

test("the two new B2 escalations are infrastructure, never model failures", () => {
  for (const reason of ["ATTESTATION_STALE", "ATTEMPT_NOT_ATTRIBUTABLE"]) {
    const m = lookupOutcome("ESCALATE", reason);
    assert.ok(m, `${reason} unmapped`);
    assert.notEqual(m?.attribution, "MODEL");
    assert.ok((m?.why.length ?? 0) > 40, "a mapping must justify itself");
  }
});
