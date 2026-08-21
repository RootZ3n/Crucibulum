/**
 * Hostile audit of the Bokahli B2 consumer.
 *
 * The consumer's most dangerous edge was that protocol generation was
 * *inferred*: a response carrying `contractVersion` or an `attemptLifetime`
 * object was B2, one carrying neither was Phase 1. Measured against a real B2
 * response, deleting two fields moved it onto the legacy path and flipped
 * `refusesCanonicalAttempt` from true to false — a response that had to be
 * discarded became an accepted attempt. Deleting only `contractVersion` was
 * worse: it still derived `runtime_tokenizer`, because the provenance rule
 * never asked which protocol it was reading.
 *
 * Absence cannot mean "older contract" when absence is also what truncation, a
 * proxy, a partial rollout, or an attacker produces. Every test here is that
 * attack or one of its relatives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  DEFAULT_PROTOCOL_PIN, resolveProtocol, BOKAHLI_B2_CONTRACT_VERSION,
} from "../core/local/responders/bokahli-protocol.js";
import {
  deriveTokenProvenance, provenanceSeal, verifyProvenanceSeal,
} from "../core/local/responders/bokahli-provenance.js";
import {
  extractB2Facts, refusesCanonicalAttempt,
} from "../core/local/responders/bokahli-b2-facts.js";
import {
  boundedString, digestString, jsonDepth, numberMap, safeCount, safeDuration, strictTrue,
} from "../core/local/responders/bokahli-validate.js";
import { lookupOutcome } from "../core/local/responders/bokahli-failure-map.js";

const run = promisify(execFile);
const ROOT = process.cwd();
const MODEL = "qwen3.5-35b-a3b.q2-k";
const DIGEST = `sha256:${"49".repeat(32)}`;
const INST = "inst-abc";

function b2(bend: (b: Record<string, any>) => void = () => {}): Record<string, any> {
  const body: Record<string, any> = {
    outcome: "ROUTED",
    route: { kind: "ROUTED", mode: "EXACT" },
    result: {
      content: "answer",
      servedIdentity: {
        modelId: MODEL, digest: DIGEST, attested: true,
        attestationMethod: "backend-props-match",
        runtime: { engine: "llama.cpp", build: "b10505-ee4c505a4" },
        qualificationFacts: {
          contractVersion: BOKAHLI_B2_CONTRACT_VERSION,
          runtime: { imageDigestBinding: "configured-tree", imageDigest: `sha256:${"e".repeat(64)}` },
          tokenizer: {
            metadataBound: true, decodeCanaryVerified: true, encodeCanaryVerified: true,
            pretokenizerVerified: true,
            canarySuiteId: "qwen35-broad.v1", canarySuiteHash: `sha256:${"03".repeat(32)}`,
            verifiedBackendInstanceId: INST, verifiedAt: "2026-08-20T12:00:00.000Z",
            unprovenReasons: [],
          },
          template: { configured: { applied: null, matchesArtifactTemplate: true }, requestConfirmed: null },
          backendInstance: { instanceId: INST, pid: 20348 },
          placement: { backendHoldsDevice: true, backendVramMiB: 2434, floorMiB: 512 },
          attestation: {
            completeness: "partial", backendInstanceId: INST, generation: 3,
            observedAt: "2026-08-20T12:00:00.000Z", expiresAt: "2026-08-20T12:01:00.000Z",
            missing: [], bindingDigest: `sha256:${"bb".repeat(32)}`,
          },
        },
      },
    },
    telemetry: {
      promptTokens: 189, completionTokens: 68,
      tokenCounts: {
        source: "runtime_tokenizer",
        promptTokenSource: "runtime_tokenizer",
        completionTokenSource: "runtime_tokenizer",
      },
      sampler: { effectiveScope: "backend-instance", effectiveSource: "runtime-slots-uncorrelated", seedSupport: "requested" },
      attemptLifetime: {
        instanceAtAdmission: INST, instanceAtCompletion: INST,
        attestationValidAtAdmission: true, instanceContinuous: true, verdict: "valid",
        crossedAttestationTtl: false, revalidation: "none", reasons: [],
      },
    },
  };
  bend(body);
  return body;
}

const derive = (body: unknown, generation: "b2" | "legacy" = "b2", raw: string | null = null) =>
  deriveTokenProvenance({
    body, expectedModelId: MODEL, expectedArtifactDigest: DIGEST,
    expectedContractVersion: BOKAHLI_B2_CONTRACT_VERSION,
    protocolGeneration: generation,
    rawResponseSha256: raw,
  });

// ---------------------------------------------------------------------------
// A. downgrade — the headline
// ---------------------------------------------------------------------------

test("A0: an untouched B2 response passes the gate and proves its counts", () => {
  const p = resolveProtocol(b2(), DEFAULT_PROTOCOL_PIN);
  assert.equal(p.ok && p.generation, "b2");
  assert.equal(derive(b2()).source, "runtime_tokenizer");
});

test("A1: no field removal can downgrade a B2 response to the legacy path", () => {
  // Each of these previously produced either a lenient legacy read or, in the
  // contractVersion case, a fully exportable verdict.
  const strips: Record<string, (b: Record<string, any>) => void> = {
    "every B2 field": (b) => {
      delete b.result.servedIdentity.qualificationFacts;
      delete b.telemetry.tokenCounts; delete b.telemetry.attemptLifetime; delete b.telemetry.sampler;
    },
    "only the contract version": (b) => {
      delete b.result.servedIdentity.qualificationFacts.contractVersion;
    },
    "the version and the lifetime": (b) => {
      delete b.result.servedIdentity.qualificationFacts.contractVersion;
      delete b.telemetry.attemptLifetime;
    },
    "only the attempt lifetime": (b) => { delete b.telemetry.attemptLifetime; },
    "only the tokenizer block": (b) => { delete b.result.servedIdentity.qualificationFacts.tokenizer; },
    "only the attestation block": (b) => { delete b.result.servedIdentity.qualificationFacts.attestation; },
    "only the placement block": (b) => { delete b.result.servedIdentity.qualificationFacts.placement; },
    "only the sampler block": (b) => { delete b.telemetry.sampler; },
    "only the token counts": (b) => { delete b.telemetry.tokenCounts; },
    "emptied B2 objects": (b) => {
      b.result.servedIdentity.qualificationFacts = {};
      b.telemetry.attemptLifetime = {};
    },
    "nulled where absence means legacy": (b) => {
      b.result.servedIdentity.qualificationFacts.contractVersion = null;
      b.telemetry.attemptLifetime = null;
    },
    "B2 identity with a Phase 1 terminal": (b) => {
      delete b.telemetry.attemptLifetime; delete b.telemetry.tokenCounts; delete b.telemetry.sampler;
    },
    "Phase 1 identity with B2 telemetry": (b) => {
      delete b.result.servedIdentity.qualificationFacts;
    },
    "arrays where blocks belong": (b) => {
      b.result.servedIdentity.qualificationFacts.tokenizer = [];
      b.telemetry.attemptLifetime = [];
    },
  };
  for (const [what, strip] of Object.entries(strips)) {
    const p = resolveProtocol(b2(strip), DEFAULT_PROTOCOL_PIN);
    assert.equal(p.ok, false, `stripping ${what} must be a protocol failure, not a legacy read`);
    if (!p.ok) assert.ok(p.problems.length > 0, `${what} must say why`);
  }
});

test("A2: a wrong contract version is refused rather than accommodated", () => {
  const p = resolveProtocol(b2((b) => {
    b.result.servedIdentity.qualificationFacts.contractVersion = "bokahli.qualification-telemetry.v2";
  }), DEFAULT_PROTOCOL_PIN);
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.problems.join(" "), /pinned to/);
});

test("A3: a legacy-targeted campaign refuses a B2 deployment", () => {
  // The other direction. Silently consuming B2 under legacy rules would score
  // evidence against checks that mode never runs.
  const p = resolveProtocol(b2(), { mode: "legacy", expectedContractVersion: BOKAHLI_B2_CONTRACT_VERSION });
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.problems.join(" "), /configured for the legacy/);
});

test("A4: a legacy-targeted campaign accepts a Phase 1 response and proves nothing", () => {
  const legacy = {
    result: { servedIdentity: { modelId: MODEL, digest: DIGEST, attested: true } },
    telemetry: { promptTokens: 120, completionTokens: 18 },
  };
  const p = resolveProtocol(legacy, { mode: "legacy", expectedContractVersion: BOKAHLI_B2_CONTRACT_VERSION });
  assert.equal(p.ok && p.generation, "legacy");
  assert.equal(derive(legacy, "legacy").source, "runtime_reported_unknown_tokenizer");
  assert.equal(refusesCanonicalAttempt(extractB2Facts(legacy), true, "legacy").refuse, false);
});

test("A5: inside B2 mode, a missing lifetime record refuses the attempt", () => {
  // The second downgrade, one level down: every continuity check compared
  // against a specific bad value, so a *deleted* record passed all of them.
  const f = extractB2Facts(b2((b) => { b.telemetry.attemptLifetime = { reasons: [] }; }));
  const r = refusesCanonicalAttempt(f, true, "b2");
  assert.equal(r.refuse, true);
  assert.match(r.reasons.join(" "), /continuity/i);
});

test("A6: legacy generation can never derive runtime_tokenizer, whatever the body claims", () => {
  // A fully proven B2 body read under legacy rules still proves nothing: the
  // generation is part of the claim.
  assert.notEqual(derive(b2(), "legacy").source, "runtime_tokenizer");
});

// ---------------------------------------------------------------------------
// B. the contract pin
// ---------------------------------------------------------------------------

const SYNC = () => join(ROOT, "scripts", "sync-bokahli-contract.mjs");
const LOCK = () => join(ROOT, "types", "bokahli-contract", "contract.lock.json");

test("B1: check mode passes and writes nothing", async () => {
  const before = await readFile(LOCK(), "utf-8");
  await run("node", [SYNC()]);
  assert.equal(await readFile(LOCK(), "utf-8"), before, "a check must never repair what it checks");
});

test("B2: syncing to an older ancestor of the published branch is refused", async () => {
  // Ancestry was the original gate and it permitted exactly this: 4d8ced6 is
  // published, and it predates the encode canary.
  const err = await run("node", [SYNC(), "--sync", "--commit", "4d8ced67bc4a176dcd06b64ea230706fb2e4a2c1"])
    .then(() => null, (e: { stderr?: string; message: string }) => `${e.stderr ?? ""}${e.message}`);
  assert.ok(err, "the downgrade must fail");
  assert.match(err, /reviewed pin is a4aac8dc/);
});

test("B3: even with --allow-pin-change the file allowlist stops a silent downgrade", async () => {
  const err = await run("node", [
    SYNC(), "--sync", "--commit", "4d8ced67bc4a176dcd06b64ea230706fb2e4a2c1", "--allow-pin-change",
  ]).then(() => null, (e: { stderr?: string; message: string }) => `${e.stderr ?? ""}${e.message}`);
  assert.ok(err);
  assert.match(err, /reviewed file set|missing canary\.ts/);
});

test("B4: an edited contract file with a regenerated lock is still caught", async () => {
  // The lock only ever certifies what sits beside it. Anchoring the lock's own
  // hash in reviewed source closes the loop.
  const file = join(ROOT, "types", "bokahli-contract", "canary.ts");
  const original = await readFile(file, "utf-8");
  const lockBefore = await readFile(LOCK(), "utf-8");
  try {
    await writeFile(file, `${original}\n// smuggled\n`, "utf-8");
    const lock = JSON.parse(lockBefore) as { files: Record<string, { sourceSha256: string }> };
    const { createHash } = await import("node:crypto");
    const body = await readFile(file, "utf-8");
    const stripped = body.slice(body.indexOf(" */\n") + 4);
    lock.files["canary.ts"] = { sourceSha256: createHash("sha256").update(stripped).digest("hex") };
    await writeFile(LOCK(), `${JSON.stringify(lock, null, 2)}\n`, "utf-8");

    const err = await run("node", [SYNC()])
      .then(() => null, (e: { stderr?: string; message: string }) => `${e.stderr ?? ""}${e.message}`);
    assert.ok(err, "a forged lock must not pass");
    assert.match(err, /not the reviewed/);
  } finally {
    await writeFile(file, original, "utf-8");
    await writeFile(LOCK(), lockBefore, "utf-8");
  }
});

test("B5: the lock binds repository, commit, generator and file set", async () => {
  const lock = JSON.parse(await readFile(LOCK(), "utf-8")) as Record<string, unknown>;
  // Advanced from 9ed481b in the same commit that added the trust-boundary
  // contract file. The rule did not change: an exact object id, never ancestry.
  assert.equal(lock["pinnedCommit"], "a4aac8dce1ee83bf9ef7d9eff7f9a0afb6e39217");
  assert.match(String(lock["remote"]), /bokahli/);
  assert.match(String(lock["generatorVersion"]), /^bokahli-contract-sync-/);
  assert.equal(Object.keys(lock["files"] as object).length, 10);
});

// ---------------------------------------------------------------------------
// C. runtime validation, because types are erased
// ---------------------------------------------------------------------------

test("C1: booleans are literal true, never truthy", () => {
  for (const v of [1, "true", "yes", {}, [], "1", 1n as unknown]) {
    assert.equal(strictTrue(v as unknown), false, `${String(v)} is not true`);
  }
  assert.equal(strictTrue(true), true);
});

test("C2: numbers are bounded, integral where they must be, and never negative", () => {
  for (const v of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 2, "5", null]) {
    assert.equal(safeCount(v as unknown), null, `${String(v)} is not a count`);
  }
  assert.equal(safeCount(0), 0);
  assert.equal(safeDuration(-1), null, "time does not run backwards");
  assert.equal(safeDuration(0), 0);
});

test("C3: digests are checked as digests", () => {
  for (const v of ["sha256:xyz", "sha256:" + "0".repeat(63), "deadbeef", "", null, 5]) {
    assert.equal(digestString(v as unknown), null, `${String(v)} is not a digest`);
  }
  assert.equal(digestString(`sha256:${"a".repeat(64)}`), `sha256:${"a".repeat(64)}`);
});

test("C4: identifiers are bounded so a peer cannot inflate every record", () => {
  assert.equal(boundedString("x".repeat(5_000)), null);
  assert.equal(boundedString("ok"), "ok");
  assert.equal(boundedString(""), null, "empty is not an identifier");
});

test("C5: prototype keys cannot travel out of a parsed body", () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":1},"constructor":2,"temperature":0.5}') as unknown;
  const m = numberMap(hostile);
  assert.ok(m);
  assert.equal(Object.prototype.hasOwnProperty.call(m as object, "__proto__"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(m as object, "constructor"), false);
  assert.equal((m as Record<string, number>)["temperature"], 0.5);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined, "no prototype was reached");
});

test("C6: arrays are not objects and deep nesting is bounded", () => {
  assert.equal(numberMap([1, 2, 3]), null);
  let deep: unknown = 1;
  for (let i = 0; i < 200; i++) deep = { n: deep };
  assert.ok(jsonDepth(deep) > 64, "the walk terminates rather than recursing forever");
});

test("C7: a hostile B2 body cannot smuggle values past validation", () => {
  const f = extractB2Facts(b2((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.canarySuiteHash = "not-a-digest";
    b.result.servedIdentity.qualificationFacts.tokenizer.canarySuiteId = "x".repeat(9_000);
    b.result.servedIdentity.qualificationFacts.attestation.generation = -4;
    b.result.servedIdentity.qualificationFacts.placement.backendVramMiB = Infinity;
    b.result.servedIdentity.qualificationFacts.attestation.expiresAt = "not-a-date";
  }));
  assert.equal(f.tokenizer.canarySuiteHash, null);
  assert.equal(f.tokenizer.canarySuiteId, null);
  assert.equal(f.instance.attestationGeneration, null);
  assert.equal(f.placement.backendVramMiB, null);
  assert.equal(f.instance.attestationExpiresAt, null);
});

test("C8: duplicate JSON keys cannot smuggle an unvalidated value", () => {
  // JSON.parse keeps the last occurrence. Whatever survives is validated, so a
  // duplicate can change the value but never bypass the check.
  const body = JSON.parse(
    '{"telemetry":{"promptTokens":"lots","promptTokens":189,"completionTokens":68,' +
    '"tokenCounts":{"source":"runtime_tokenizer","promptTokenSource":"runtime_tokenizer",' +
    '"completionTokenSource":"runtime_tokenizer"}}}',
  ) as Record<string, unknown>;
  const v = derive(body);
  assert.notEqual(v.source, "runtime_tokenizer", "no identity, no attestation, no proof");
  // Last-wins, and the survivor is still validated: the string is rejected and
  // the map comes back empty rather than carrying an unchecked value.
  const hostile = JSON.parse('{"a":1,"a":"not-a-number"}') as unknown;
  assert.deepEqual(Object.entries(numberMap(hostile) ?? {}), []);
});

// ---------------------------------------------------------------------------
// D. the proof set
// ---------------------------------------------------------------------------

test("D1: one proven count cannot carry an unproven one", () => {
  for (const side of ["promptTokenSource", "completionTokenSource"]) {
    const v = derive(b2((b) => {
      b.telemetry.tokenCounts[side] = "runtime_reported_unknown_tokenizer";
    }));
    assert.notEqual(v.source, "runtime_tokenizer", `${side} unproven must block`);
    assert.match(v.unmet.join(" "), /provenance of their own/);
  }
});

test("D2: the instance must be one instance everywhere it is named", () => {
  for (const where of ["instanceAtAdmission", "instanceAtCompletion"]) {
    const v = derive(b2((b) => { b.telemetry.attemptLifetime[where] = "inst-other"; }));
    assert.notEqual(v.source, "runtime_tokenizer", `${where} disagreeing must block`);
    assert.match(v.unmet.join(" "), /one backend instance/);
  }
  const canary = derive(b2((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.verifiedBackendInstanceId = "inst-other";
  }));
  assert.notEqual(canary.source, "runtime_tokenizer");
});

test("D3: an incoherent attestation window blocks the claim", () => {
  for (const bend of [
    (b: Record<string, any>) => { b.result.servedIdentity.qualificationFacts.attestation.generation = -1; },
    (b: Record<string, any>) => {
      b.result.servedIdentity.qualificationFacts.attestation.expiresAt = "2026-08-20T11:59:00.000Z";
    },
    (b: Record<string, any>) => { delete b.result.servedIdentity.qualificationFacts.attestation.observedAt; },
  ]) {
    const v = derive(b2(bend));
    assert.notEqual(v.source, "runtime_tokenizer");
    assert.match(v.unmet.join(" "), /coherent generation and validity window/);
  }
});

test("D4: every rejected proof names itself", () => {
  const v = derive(b2((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
  }));
  assert.equal(v.unmet.length, 1, `expected exactly one unmet proof, got ${v.unmet.join(" | ")}`);
  assert.match(v.unmet[0] as string, /encode canary/);
  assert.equal(v.proof.encodeCanaryVerified, false);
  assert.equal(v.proof.decodeCanaryVerified, true, "the others are still individually reported");
});

// ---------------------------------------------------------------------------
// E. legacy evidence cannot be enriched into qualified evidence
// ---------------------------------------------------------------------------

test("E1: the verdict is sealed to the response that produced it", () => {
  const raw = `sha256:${"7".repeat(64)}`;
  const v = derive(b2(), "b2", raw);
  assert.equal(verifyProvenanceSeal(v, raw), true);
  assert.equal(verifyProvenanceSeal(v, `sha256:${"8".repeat(64)}`), false,
    "a verdict cannot be moved onto another response");
});

test("E2: flipping any proof after the fact breaks the seal", () => {
  const raw = `sha256:${"7".repeat(64)}`;
  const legacy = derive({ telemetry: { promptTokens: 5, completionTokens: 5 } }, "legacy", raw);
  assert.equal(legacy.source, "runtime_reported_unknown_tokenizer");
  // Post-hoc enrichment: promote the verdict and the proofs.
  const enriched = {
    ...legacy,
    source: "runtime_tokenizer" as const,
    proof: { ...legacy.proof, encodeCanaryVerified: true, decodeCanaryVerified: true },
    unmet: [],
  };
  assert.equal(verifyProvenanceSeal(enriched, raw), false, "the paperwork changed; the seal did not");
});

test("E3: copying a B2 identity from a passing attempt breaks the seal", () => {
  const raw = `sha256:${"7".repeat(64)}`;
  const good = derive(b2(), "b2", raw);
  const poor = derive(b2((b) => {
    b.result.servedIdentity.qualificationFacts.tokenizer.encodeCanaryVerified = false;
  }), "b2", raw);
  const stolen = {
    ...poor,
    canarySuiteId: good.canarySuiteId,
    canarySuiteHash: good.canarySuiteHash,
    servingInstanceId: good.servingInstanceId,
    seal: good.seal,
  };
  // The stolen seal belongs to a different proof set, so it fails to verify.
  assert.equal(verifyProvenanceSeal(stolen, raw), false);
});

test("E4: nulls converted to flattering defaults break the seal", () => {
  const raw = `sha256:${"7".repeat(64)}`;
  const v = derive(b2((b) => { b.result.servedIdentity.qualificationFacts.tokenizer.canarySuiteHash = null; }), "b2", raw);
  const defaulted = { ...v, canarySuiteHash: `sha256:${"03".repeat(32)}` };
  assert.equal(verifyProvenanceSeal(defaulted, raw), false);
});

test("E5: the seal is a function of the proof, not of a stored string", () => {
  const raw = `sha256:${"7".repeat(64)}`;
  const v = derive(b2(), "b2", raw);
  const recomputed = provenanceSeal({
    source: v.source, proof: v.proof, declaredSource: v.declaredSource,
    canarySuiteId: v.canarySuiteId, canarySuiteHash: v.canarySuiteHash,
    servingInstanceId: v.servingInstanceId, admissionInstanceId: v.admissionInstanceId,
    terminalInstanceId: v.terminalInstanceId, rawResponseSha256: raw,
  });
  assert.equal(recomputed, v.seal);
});

// ---------------------------------------------------------------------------
// F. outcome mapping under contradiction
// ---------------------------------------------------------------------------

test("F1: an unknown outcome or reason is never model-attributed", () => {
  for (const [kind, reason] of [
    ["ESCALATE", "SOMETHING_NEW"], ["REFUSED", "ALSO_NEW"],
    ["CAPACITY_UNAVAILABLE", "UNHEARD_OF"], ["HTTP", "TEAPOT"],
    // A reason that is real, for a different outcome.
    ["REFUSED", "RUNTIME_UNHEALTHY"], ["ESCALATE", "EXACT_DIGEST_MISMATCH"],
  ] as const) {
    const m = lookupOutcome(kind as "ESCALATE", reason);
    assert.notEqual(m?.attribution, "MODEL", `${kind}/${reason} must not be a model failure`);
  }
});

test("F2: ATTEMPT_NOT_ATTRIBUTABLE is infrastructure however good the output looks", () => {
  const m = lookupOutcome("ESCALATE", "ATTEMPT_NOT_ATTRIBUTABLE");
  assert.ok(m);
  assert.notEqual(m?.attribution, "MODEL");
  const f = extractB2Facts(b2((b) => {
    b.telemetry.attemptLifetime.verdict = "infrastructure-invalid";
    b.result.content = '{"outcome":"ABSTAINED","confidence":"high"}';
  }));
  assert.equal(refusesCanonicalAttempt(f, true, "b2").refuse, true);
});

test("F3: a protocol mismatch is composite, never a model failure", () => {
  const m = lookupOutcome("TRANSPORT", "protocol_mismatch");
  assert.ok(m);
  assert.notEqual(m?.attribution, "MODEL");
  assert.match(m?.why ?? "", /absence of a field is not a version/);
});

// ---------------------------------------------------------------------------
// G. honesty about template, sampler and placement
// ---------------------------------------------------------------------------

test("G1: no configured or backend-scoped fact becomes request-confirmed", () => {
  const f = extractB2Facts(b2());
  assert.equal(f.template.requestConfirmed, false);
  assert.equal(f.template.configuredApplied, null);
  assert.equal(f.sampler.effectiveScope, "backend-instance");
  assert.notEqual(f.sampler.effectiveScope, "request");
  assert.equal(f.sampler.seedSupport, "requested");
  assert.notEqual(f.sampler.seedSupport, "honoured");
});

test("G2: a matching artifact template does not imply this request used it", () => {
  const f = extractB2Facts(b2());
  assert.equal(f.template.matchesArtifactTemplate, true);
  assert.equal(f.template.configuredApplied, null, "matching is not applying");
  assert.equal(f.template.requestConfirmed, false);
});

test("G3: configured-tree never becomes process-observed, and whole-GPU is not placement", () => {
  assert.equal(extractB2Facts(b2()).imageDigestIsProcessObserved, false);
  const f = extractB2Facts(b2());
  // Placement is per-process and comes from its own block; nothing here reads a
  // whole-device number into it.
  assert.equal(f.placement.backendHoldsDevice, true);
  assert.equal(f.placement.floorMiB, 512);
});

test("G4: missing facts stay null rather than becoming favourable defaults", () => {
  const f = extractB2Facts(b2((b) => {
    delete b.result.servedIdentity.qualificationFacts.placement.backendHoldsDevice;
    delete b.result.servedIdentity.qualificationFacts.template.configured.matchesArtifactTemplate;
    delete b.telemetry.sampler.seedSupport;
  }));
  assert.equal(f.placement.backendHoldsDevice, null);
  assert.equal(f.template.matchesArtifactTemplate, null);
  assert.equal(f.sampler.seedSupport, null);
});

// ---------------------------------------------------------------------------
// H. export and import, end to end through Bokahli's real importer
// ---------------------------------------------------------------------------
//
// The exporter's rule is one line — only `runtime_tokenizer` exports — and the
// value of running it here is showing which *responder verdicts* reach that
// line. A campaign is a set of attempts, and the interesting failures are the
// mixed ones: one proven attempt beside one that is not.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { exportBokahliBundle } from "../core/local/bokahli-export.js";
import { scoreAttempt, LOCAL_REGIME_VERSION, type AttemptRecord } from "../core/local/regime.js";
import { LOCAL_IDENTITY_VERSION } from "../types/local-identity.js";

const XMODEL = "testmodel.q4-k";
const XDIGEST = `sha256:${"a".repeat(64)}`;

function xIdentity(tokenCountSource: string) {
  return {
    identityVersion: LOCAL_IDENTITY_VERSION,
    artifact: {
      modelId: XMODEL, artifactDigest: XDIGEST, quantization: "Q4_K", format: "gguf",
      sizeBytes: 1, parameterCount: 1, activeParameterCount: null,
    },
    runtime: { name: "llama.cpp", build: "b1-test", binaryDigest: null, apiFlavour: "openai-compatible" },
    promptTemplate: {
      templateId: "peg-native", templateDigest: `sha256:${"a4".repeat(32)}`,
      appliedBy: "runtime", bosTokenId: null, eosTokenId: 1,
    },
    sampler: { temperature: 0, topP: 1, topK: null, repeatPenalty: null, seed: 7, seedHonoured: true },
    hardware: {
      profileId: "rig-1", gpuModel: null, gpuMemoryMiB: null, gpuDriver: null,
      cudaVersion: null, cpuModel: null, systemMemoryMiB: null,
    },
    placement: {
      requestedGpuLayers: 999, observedGpuLayers: 999, cpuOffloadEnabled: true,
      observedVramBytes: 1, observedHostRamBytes: 1, gpuConfirmed: true,
    },
    context: {
      configuredTokens: 32768, effectiveMaxTokens: 8000, tierLabel: "control", tokenCountSource,
    },
    concurrency: { slots: 1, maxConcurrentRequests: 1, batchSize: null },
    generation: {
      regime: "unconstrained", contractVersion: "bokahli.structured-output/1",
      outputSchemaDigest: null, enforcementRequested: false, enforcementConfirmed: null,
      evidencePolicyVersion: "bokahli.evidence-policy/1",
      evidencePolicyDigest: `sha256:${"c".repeat(64)}`, reasoningMode: "none",
    },
    fixtureSuiteId: "local-test-log-triage",
    fixtureSuiteVersion: "1.0.0",
    verificationRegimeVersion: LOCAL_REGIME_VERSION,
  };
}

/** A correct campaign's evidence-transport block: sent, inspected, fenced. */
function xTransport(): NonNullable<AttemptRecord["evidenceTransport"]> {
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
  };
}

// No `as AttemptRecord` here any more. That assertion is what let this file
// keep building records with no evidence-transport block while every other
// construction site was caught by the compiler — and a record with no block is
// a legacy record, which is exactly what the exporter now refuses.
function xRecord(over: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attemptId: "a1", evidenceTransport: xTransport(),
    generation: {
      regime: "unconstrained", contractVersion: "bokahli.structured-output/1",
      outputSchemaDigest: null, enforcementRequested: false, enforcementConfirmed: null,
      evidencePolicyVersion: "bokahli.evidence-policy/1",
      evidencePolicyDigest: `sha256:${"c".repeat(64)}`, evidencePolicyApplied: true,
    },
    completion: { sha256: `sha256:${"b".repeat(64)}`, chars: 64, finishReason: "stop" },
    fixtureId: "tlt-008-abstention-required",
    suiteId: "local-test-log-triage", suiteVersion: "1.0.0",
    split: "evaluation", applicability: "APPLICABLE",
    lanes: [{
      lane: "facts", scorerVersion: "local-scorers-1.1.0",
      measurements: [{ name: "facts.recall", value: 1, unit: "ratio", detail: "" }],
      failureCodes: [], attribution: "MODEL", notes: [],
    }],
    contextPosition: null, contextTier: "control",
    promptTokens: 100, completionTokens: 20, tokenCountSource: "runtime_tokenizer",
    timeToFirstTokenMs: 200, decodeTokensPerSecond: 60, wallTimeMs: 900, seed: 1,
    ...over,
  };
}

function xExport(records: readonly AttemptRecord[], identityTokenSource: string) {
  return exportBokahliBundle({
    taskClass: "test_log_triage", taskClassContractVersion: "1.0.0",
    identity: xIdentity(identityTokenSource) as never,
    records: [...records], scored: records.map(scoreAttempt),
    luakBundleIds: records.map((r) => r.attemptId), luakBundleHashes: [],
    luakSignatureStatus: "unsigned_key_missing", luakRepoCommit: "c9a83c5",
    now: new Date("2026-08-20T12:00:00.000Z"),
  });
}

test("H1: only a campaign whose every attempt is proven can be exported", () => {
  const proven = [xRecord({ attemptId: "a1" }),
    xRecord({ attemptId: "a2", fixtureId: "tlt-009-injection-in-log" })];
  assert.equal(xExport(proven, "runtime_tokenizer").ok, true, "the proven baseline exports");

  const scenarios: Record<string, { records: AttemptRecord[]; identity: string }> = {
    "an explicit legacy campaign": {
      records: proven.map((r) => ({ ...r, tokenCountSource: "runtime_reported_unknown_tokenizer" })),
      identity: "runtime_reported_unknown_tokenizer",
    },
    "a stripped B2 response (counts unknown)": {
      records: proven.map((r) => ({ ...r, tokenCountSource: "unknown" })),
      identity: "unknown",
    },
    "a mixed legacy/B2 campaign": {
      // One proven attempt beside one that is not. The weakest attempt governs.
      records: [proven[0] as AttemptRecord,
        { ...(proven[1] as AttemptRecord), tokenCountSource: "runtime_reported_unknown_tokenizer" }],
      identity: "runtime_tokenizer",
    },
    "a mixed protocol identity": {
      // Attempts claim proof, the identity does not. Bokahli's contract has one
      // tokenCountSource per identity, and a disagreement is not exportable.
      records: proven,
      identity: "runtime_reported_unknown_tokenizer",
    },
    "post-hoc enrichment of a legacy attempt": {
      // The paperwork says proven; nothing else about the run changed. It is
      // caught here by the identity, and by the seal at the responder.
      records: proven.map((r) => ({ ...r, tokenCountSource: "runtime_tokenizer" })),
      identity: "unknown",
    },
  };
  for (const [what, { records, identity }] of Object.entries(scenarios)) {
    const r = xExport(records, identity);
    assert.equal(r.ok, false, `${what} must not export`);
    if (!r.ok) {
      assert.ok(r.refusals.length > 0, `${what} must refuse with a typed reason`);
      assert.ok(
        r.refusals.some((x) => /TOKEN_COUNTS_NOT_MEASURED|CONTEXT_TIER_NOT_MEASURED/.test(x.code)),
        `${what} refused with ${r.refusals.map((x) => x.code).join(",")}`,
      );
    }
  }
});

test("H2: a complete, consistent export is accepted by Bokahli's real importer", async () => {
  const bokahliDist = process.env["BOKAHLI_DIST"]
    ?? resolve(ROOT, "..", "bokahli", "packages", "qualification", "dist");
  const importerPath = join(bokahliDist, "importer.js");
  assert.ok(existsSync(importerPath),
    `Bokahli's built importer was not found at ${importerPath}; a compatibility claim that ` +
    "cannot be checked should not be made");

  const { importQualificationBundle } = await import(importerPath) as {
    importQualificationBundle: (raw: unknown, ctx: Record<string, unknown>) => {
      ok: boolean;
      errors?: { code: string }[];
      accepted?: { importTrust: { accepted: boolean; basis: string } };
    };
  };

  const proven = [xRecord({ attemptId: "a1" }),
    xRecord({ attemptId: "a2", fixtureId: "tlt-009-injection-in-log" })];
  const exported = xExport(proven, "runtime_tokenizer");
  assert.equal(exported.ok, true);
  if (!exported.ok) return;

  const ctx = {
    installedArtifacts: [{ modelId: XMODEL, digest: XDIGEST, quantization: "Q4_K" }],
    runtimeName: "llama.cpp", runtimeBuild: "b1-test", hardwareProfileId: "rig-1",
    servedContextTokens: 8000,
    now: new Date("2026-08-20T13:00:00.000Z"),
  };
  const good = importQualificationBundle(exported.bundle, ctx);
  assert.equal(good.ok, true,
    `importer rejected a complete bundle: ${JSON.stringify(good.errors ?? [])}`);

  // Importable means integrity-valid and *untrusted*. Luak never grants trust,
  // and must not be able to: the operator does, by pinning a digest.
  assert.equal(good.accepted?.importTrust.accepted, false,
    "Luak must never produce a bundle Bokahli reads as trusted");
  assert.equal(JSON.stringify(exported.bundle).includes("importTrust"), false,
    "and the exporter emits no trust field at all");

  // A single edited byte must not import.
  const tampered = JSON.parse(JSON.stringify(exported.bundle)) as Record<string, any>;
  tampered.attempts[0].promptTokens = 101;
  const bad = importQualificationBundle(tampered, ctx);
  assert.equal(bad.ok, false, "an edited bundle must fail integrity");
});
