/**
 * Local taxonomy, identity, and the family-name truth rule.
 *
 * The proofs here are the ones that stop local qualification from quietly
 * becoming something else: that the new failure vocabulary does not redefine
 * the old one, that evidence cannot exist without naming what it is about, and
 * that a directory name can never override a declared task family.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  LOCAL_FAILURE_CODES,
  LOCAL_FAILURE_MAP,
  LOCAL_TAXONOMY_VERSION,
  isModelAttributable,
  newlyAddedCodes,
  toLegacyVerdict,
  type LocalFailureCode,
} from "../types/local-verdict.js";
import {
  LOCAL_IDENTITY_VERSION,
  REQUIRED_LOCAL_IDENTITY_PATHS,
  checkLocalIdentity,
  isLocalQualifiable,
  placementConfirmed,
} from "../types/local-identity.js";
import { FAILURE_REASON_CODES_FOR_TEST } from "./helpers/legacy-codes.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

// ---------------------------------------------------------------------------
// taxonomy preserves existing semantics
// ---------------------------------------------------------------------------

test("every local code maps onto a real existing FailureReasonCode", () => {
  for (const code of LOCAL_FAILURE_CODES) {
    const legacy = LOCAL_FAILURE_MAP[code].legacyReasonCode;
    assert.ok(
      FAILURE_REASON_CODES_FOR_TEST.includes(legacy),
      `${code} maps to ${legacy}, which is not an existing FailureReasonCode`,
    );
  }
});

test("the existing NC / failure-rate rules are reproduced exactly", () => {
  for (const code of LOCAL_FAILURE_CODES) {
    const v = toLegacyVerdict(code);
    // These two lines are the rule from core/verdict.ts, restated. If either
    // drifts, historical scores and local scores stop meaning the same thing.
    assert.equal(v.countsTowardModelScore, v.completionState !== "NC", code);
    assert.equal(
      v.countsTowardFailureRate,
      v.completionState === "FAIL" && v.failureOrigin === "MODEL",
      code,
    );
  }
});

test("infrastructure failures never count toward a model score", () => {
  const infra: LocalFailureCode[] = [
    "local_timeout_load", "local_timeout_prefill", "local_timeout_decode",
    "local_runtime_crash", "local_resource_exhausted",
    "local_unintended_device_placement", "local_wrong_served_artifact",
    "local_capacity_refused", "local_context_overflow",
    "local_harness_parse_failure", "local_harness_judge_failure",
    "local_harness_extraction_failure", "local_prompt_template_mismatch",
  ];
  for (const code of infra) {
    const mapping = LOCAL_FAILURE_MAP[code];
    assert.equal(mapping.countsTowardModelScore, false, `${code} must not count against the model`);
    assert.equal(isModelAttributable(mapping.attribution), false, `${code} must not be MODEL-attributed`);
    assert.equal(toLegacyVerdict(code).completionState, "NC", `${code} must be NC`);
  }
});

test("free-text extraction failure is COMPOSITE, not a model failure", () => {
  // The distinction the whole exercise turns on: "our extractor did not
  // recognise the output" is not "the model cannot use tools".
  const m = LOCAL_FAILURE_MAP["local_harness_extraction_failure"];
  assert.equal(m.attribution, "COMPOSITE");
  assert.equal(m.countsTowardModelScore, false);
});

test("every added code justifies itself, and reused codes claim no novelty", () => {
  for (const code of LOCAL_FAILURE_CODES) {
    const m = LOCAL_FAILURE_MAP[code];
    assert.ok(m.why.length > 20, `${code} has no justification`);
    if (m.reusesExisting) {
      assert.ok(
        !/^New\./.test(m.why),
        `${code} claims to reuse an existing code but its note says it is new`,
      );
    } else {
      assert.ok(/^New/.test(m.why), `${code} is new but does not say why it could not be reused`);
    }
  }
  // Pin the count so adding a code is a deliberate, reviewed act.
  assert.equal(newlyAddedCodes().length, 11, `newly added codes: ${newlyAddedCodes().join(", ")}`);
});

test("a valid abstention is a PASS, so abstention can be scored at all", () => {
  const v = toLegacyVerdict("local_valid_abstention");
  assert.equal(v.completionState, "PASS");
  assert.equal(v.countsTowardFailureRate, false);
});

test("the taxonomy is versioned", () => {
  assert.match(LOCAL_TAXONOMY_VERSION, /^local-failure-taxonomy-\d+\.\d+\.\d+$/);
});

// ---------------------------------------------------------------------------
// local identity
// ---------------------------------------------------------------------------

function fullIdentity(): Record<string, unknown> {
  return {
    identityVersion: LOCAL_IDENTITY_VERSION,
    artifact: {
      modelId: "testmodel.q4-k", artifactDigest: `sha256:${"a".repeat(64)}`,
      quantization: "Q4_K", format: "gguf", sizeBytes: 1, parameterCount: 1,
      activeParameterCount: null,
    },
    runtime: { name: "llama.cpp", build: "b1-test", binaryDigest: null, apiFlavour: "openai-compatible" },
    promptTemplate: { templateId: "chatml", templateDigest: null, appliedBy: "runtime", bosTokenId: null, eosTokenId: null },
    sampler: { temperature: 0, topP: 1, topK: null, repeatPenalty: null, seed: 7, seedHonoured: true },
    hardware: { profileId: "rig-1", gpuModel: null, gpuMemoryMiB: null, gpuDriver: null, cudaVersion: null, cpuModel: null, systemMemoryMiB: null },
    placement: { requestedGpuLayers: 999, observedGpuLayers: 999, cpuOffloadEnabled: true, observedVramBytes: 1, observedHostRamBytes: 1, gpuConfirmed: true },
    context: { configuredTokens: 32768, effectiveMaxTokens: 8000, tierLabel: "8k", tokenCountSource: "runtime_tokenizer" },
    concurrency: { slots: 1, maxConcurrentRequests: 1, batchSize: null },
    generation: {
      regime: "unconstrained", contractVersion: "bokahli.structured-output/1",
      outputSchemaDigest: null, enforcementRequested: false, enforcementConfirmed: null,
      evidencePolicyVersion: "bokahli.evidence-policy/1",
      evidencePolicyDigest: `sha256:${"c".repeat(64)}`, reasoningMode: "none",
    },
    fixtureSuiteId: "local-test-log-triage",
    fixtureSuiteVersion: "1.0.0",
    verificationRegimeVersion: "local-regime-1.0.0",
  };
}

test("a complete local identity is accepted", () => {
  const r = checkLocalIdentity(fullIdentity());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(isLocalQualifiable(fullIdentity()), true);
});

test("hosted evidence — no local identity at all — is simply not local-qualifiable", () => {
  // Not an error, and not a defect in the hosted bundle. It is a statement that
  // this evidence is about a hosted endpoint rather than an artifact.
  assert.equal(isLocalQualifiable(undefined), false);
  assert.equal(isLocalQualifiable(null), false);
  assert.equal(isLocalQualifiable({ agent: { model: "gpt-x", provider: "openai" } }), false);
  const r = checkLocalIdentity(undefined);
  assert.deepEqual([...r.missing], [...REQUIRED_LOCAL_IDENTITY_PATHS]);
});

test("every required identity field is individually load-bearing", () => {
  for (const path of REQUIRED_LOCAL_IDENTITY_PATHS) {
    const id = fullIdentity();
    const parts = path.split(".");
    let cur = id as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
    delete cur[parts[parts.length - 1] as string];
    assert.equal(isLocalQualifiable(id), false, `removing ${path} must make it unqualifiable`);
  }
});

test("a filesystem path is never accepted as a model identity", () => {
  const id = fullIdentity();
  (id["artifact"] as Record<string, unknown>)["modelId"] = "/home/zen/models/x.gguf";
  const r = checkLocalIdentity(id);
  assert.equal(r.ok, false);
  assert.ok(r.invalid.some((i) => i.path === "artifact.modelId"));
});

test("a malformed digest is refused", () => {
  const id = fullIdentity();
  (id["artifact"] as Record<string, unknown>)["artifactDigest"] = "sha256:NOTHEX";
  assert.equal(isLocalQualifiable(id), false);
});

test("device placement is confirmed, never inferred from the request", () => {
  assert.equal(placementConfirmed({
    requestedGpuLayers: 999, observedGpuLayers: 0, cpuOffloadEnabled: true,
    observedVramBytes: null, observedHostRamBytes: null, gpuConfirmed: false,
  }), false, "asking for 999 layers is not evidence of getting them");
  assert.equal(placementConfirmed({
    requestedGpuLayers: 999, observedGpuLayers: 999, cpuOffloadEnabled: true,
    observedVramBytes: 1, observedHostRamBytes: 1, gpuConfirmed: true,
  }), true);
});

// ---------------------------------------------------------------------------
// family truth: directory names may not override declared identity
// ---------------------------------------------------------------------------

function allManifests(): { path: string; dirName: string; manifest: Record<string, unknown> }[] {
  const out: { path: string; dirName: string; manifest: Record<string, unknown> }[] = [];
  const tasksDir = join(ROOT, "tasks");
  if (!existsSync(tasksDir)) return out;
  const walk = (dir: string, top: string | null): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, top ?? e.name);
      else if (e.name === "manifest.json") {
        out.push({ path: p, dirName: top ?? "", manifest: JSON.parse(readFileSync(p, "utf-8")) });
      }
    }
  };
  walk(tasksDir, null);
  return out;
}

test("task family comes from the manifest, never from the directory name", () => {
  const manifests = allManifests();
  assert.ok(manifests.length >= 80, `expected the full corpus, found ${manifests.length}`);

  // Proof by counterexample, from the tree itself: tasks/classification/ declares
  // family "identity" and tasks/code/ declares "truthfulness". Any tool that
  // keyed on the directory would mis-file both, which is why the census reads
  // the field and this test exists to keep it honest.
  const divergent = manifests.filter((m) => m.dirName.replace(/-/g, "_") !== m.manifest["family"]);
  assert.ok(
    divergent.length > 0,
    "expected at least one task whose directory name differs from its declared family",
  );

  for (const m of manifests) {
    assert.equal(typeof m.manifest["family"], "string", `${m.path} declares no family`);
    assert.ok((m.manifest["family"] as string).length > 0, `${m.path} declares an empty family`);
  }
});

test("the census reads declared families, not directories", () => {
  const censusPath = join(ROOT, "docs", "local", "CENSUS.json");
  assert.ok(existsSync(censusPath), "run scripts/local-census.mjs");
  const census = JSON.parse(readFileSync(censusPath, "utf-8"));
  const declared = new Set(allManifests().map((m) => m.manifest["family"] as string));
  const censusFamilies = new Set(Object.keys(census.families));
  assert.deepEqual([...censusFamilies].sort(), [...declared].sort());

  // And the directory names are genuinely different, so this is not vacuous.
  const dirs = new Set(allManifests().map((m) => m.dirName));
  assert.notDeepEqual([...dirs].sort(), [...declared].sort());
});

test("every family carries an authored local-qualification judgement", () => {
  const census = JSON.parse(readFileSync(join(ROOT, "docs", "local", "CENSUS.json"), "utf-8"));
  for (const [name, f] of Object.entries<Record<string, unknown>>(census.families)) {
    const a = f["annotation"] as Record<string, unknown> | null;
    assert.ok(a, `${name} has no annotation`);
    for (const key of ["measures", "oracleKind", "appliesToLocal", "confounds", "dimension", "disposition"]) {
      assert.ok(a[key], `${name}.${key} is missing`);
    }
  }
});

test("agentic families are recorded as harness-coupled and excluded from local", () => {
  const census = JSON.parse(readFileSync(join(ROOT, "docs", "local", "CENSUS.json"), "utf-8"));
  for (const fam of ["orchestration", "poison_localization", "spec_discipline", "tool_calling"]) {
    const f = census.families[fam];
    assert.ok(f, `${fam} absent from the census`);
    assert.equal(f.needsShell, true, `${fam} should require shell`);
    assert.equal(f.annotation.disposition, "exclude_from_local",
      `${fam} must not silently qualify a chat-only local model`);
    assert.match(String(f.annotation.confounds), /^yes/,
      `${fam} must be recorded as confounding model and harness capability`);
  }
});
