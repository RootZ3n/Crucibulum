import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HowaReceiptImportError,
  computeHowaReceiptDigest,
  importHowaReceipt,
  validateHowaReceipt,
  type HowaDailyDriverReceipt,
} from "../core/howa-daily-driver.js";
import { deriveHowaMetrics, loadImportedHowaResults, projectHowaScoreboard, REQUIRED_DAILY_DRIVER_TRIAL_IDS } from "../core/howa-daily-driver-scoring.js";

const now = "2026-08-22T12:00:00.000Z";
const hash = (char: string) => `sha256:${char.repeat(64)}`;
const fixtureCases = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "howa-daily-driver-negative-cases.json"), "utf8")) as string[];

function receipt(overrides: Partial<HowaDailyDriverReceipt> = {}): HowaDailyDriverReceipt {
  const value: HowaDailyDriverReceipt = {
    schema_version: "howa.hermes-daily-driver.receipt.v3", receipt_digest: hash("0"), trial_id: "ddv1-01-porcelain-parser", trial_suite_version: "hermes-daily-driver.v1.1", run_id: "run-1", timestamp: now,
    model_id: "offline/mock-v2", provider_id: "offline", provider_route: "direct", reasoning_level: "max", served_model_identity: "offline/mock-v2",
    hermes_version: "offline-proof-v1", hermes_commit: "sha256:a4249fdb8dfda815d88992dca0582ad58e704d75afce0032b58e70d20364ebc6", hermes_launcher_digest: "sha256:3f0f753fba087a2789530e59e0cc9480aa4f847c644f67135f1e87287387ad56", terminal_sandbox_digest:"sha256:1e4c00bd9498aedebc024e556e4790076694db50ca8182e554fcd9b242c35b44",runtime_policy_version:"howa.ddv1-runtime.2026-08-22.3",runtime_policy_digest:"sha256:03b996b787ad78295c1731c6bb97f9d190b378f643ff97add6b6c5a71df67807", hermes_executable_digest: "sha256:a4249fdb8dfda815d88992dca0582ad58e704d75afce0032b58e70d20364ebc6", hermes_arguments: ["--oneshot"], requested_temperature: null, hermes_configuration_digest: hash("1"), system_prompt_digest: hash("2"), tool_registry_digest: hash("3"), fixture_digest: hash("4"),campaign_entropy_commitment:hash("e"),
    start_timestamp: now, end_timestamp: now, wall_clock_duration_ms: 100,
    attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 0, outcome: "accepted_output", error_kind: null, retryable: false, stdout_digest: hash("5"), stderr_digest: hash("6"),timeout_stage:"none",signals_sent:[],cleanup_outcome:"not_required" }],
    retries: 0, connection_failures: [], timeout_events: [], compaction_events: [], input_tokens: 10, output_tokens: 5, charged_cost_usd: 0.02, api_equivalent_cost_usd: 0.02, plan_credit_consumed: null, subscription_quota_consumed: null, cost_rate_card_version: "howa.ddv1-rates.2026-08-22.1", cost_provenance: "provider_actual", candidate_accommodations: [], max_turns: 24, max_output_tokens: 8192, limits_enforcement: "enforced",
    tool_calls: [], mutation_observations: [], deterministic_checks: [{ id: "porcelain.evidence", passed: true, details: "verified", evidence_refs: ["candidate.stdout"] }],
    raw_verdict: "PASS", evidence_references: [{ id: "candidate.stdout", kind: "stdout", path: "artifacts/run-1/ddv1-01-porcelain-parser/stdout.txt", digest: hash("7") },{id:"runtime-identity.json",kind:"artifact",path:"artifacts/run-1/ddv1-01-porcelain-parser/runtime-identity.json",digest:hash("8")}],evidence_manifest_path:"manifests/run-1/ddv1-01-porcelain-parser.evidence-manifest.json",evidence_manifest_digest:hash("9"),evidence_bundle_mode:"receipt-plus-evidence-directory",redaction_events:[], correction_rounds: 0, accepted: true, disqualifier_codes: [],
    ...overrides,
  };
  value.receipt_digest = computeHowaReceiptDigest(value as unknown as Record<string, unknown>);
  return value;
}

function root(): string { return mkdtempSync(join(tmpdir(), "luak-howa-import-")); }
function source(dir: string, value: unknown, name = "receipt.json"): { path: string; bytes: string } {
  const r=value as HowaDailyDriverReceipt; const canonical=(item:unknown):string=>{if(item===null||typeof item==="boolean"||typeof item==="string"||typeof item==="number")return JSON.stringify(item);if(Array.isArray(item))return`[${item.map(canonical).join(",")}]`;const o=item as Record<string,unknown>;return`{${Object.keys(o).sort().map(k=>`${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;};const sha=(bytes:string)=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const base=join(dir,"evidence"); const artifact=`artifacts/${r.run_id}/${r.trial_id}`; const stdout="synthetic evidence\n";
  const identity=`${canonical({hermes_launcher_digest:r.hermes_launcher_digest,terminal_sandbox_digest:r.terminal_sandbox_digest,hermes_executable_digest:r.hermes_executable_digest,runtime_policy_version:r.runtime_policy_version,runtime_policy_digest:r.runtime_policy_digest,hermes_configuration_digest:r.hermes_configuration_digest,system_prompt_digest:r.system_prompt_digest,tool_registry_digest:r.tool_registry_digest,cost_rate_card_version:r.cost_rate_card_version,campaign_entropy_commitment:r.campaign_entropy_commitment})}\n`;
  const authority=`${canonical({schema_version:"howa.ddv1-authority.v2",run_id:r.run_id,trial_id:r.trial_id,entropy_commitment:r.campaign_entropy_commitment,fixture_digest:r.fixture_digest,authority_digest:hash("a")})}\n`;
  r.attempts[0]!.stdout_digest=sha(stdout); r.evidence_references=[{id:"candidate.stdout",kind:"stdout",path:`${artifact}/stdout.txt`,digest:sha(stdout)},{id:"runtime-identity.json",kind:"artifact",path:`${artifact}/runtime-identity.json`,digest:sha(identity)},{id:"trusted-authority.json",kind:"artifact",path:`${artifact}/trusted-authority.json`,digest:sha(authority)}];
  const contents:Record<string,string>={"candidate.stdout":stdout,"runtime-identity.json":identity,"trusted-authority.json":authority}; const entries=r.evidence_references.map(ref=>({path:ref.path,byte_length:Buffer.byteLength(contents[ref.id]!),digest:ref.digest,evidence_class:ref.kind,run_id:r.run_id,trial_id:r.trial_id})).sort((a,b)=>a.path.localeCompare(b.path)); const manifest=`${canonical({schema_version:"howa.hermes-daily-driver.evidence-manifest.v1",run_id:r.run_id,trial_id:r.trial_id,entries})}\n`;
  r.evidence_manifest_path=`manifests/${r.run_id}/${r.trial_id}.evidence-manifest.json`; r.evidence_manifest_digest=sha(manifest); r.receipt_digest=computeHowaReceiptDigest(r as unknown as Record<string,unknown>); mkdirSync(join(base,artifact),{recursive:true}); mkdirSync(join(base,"manifests",r.run_id),{recursive:true}); writeFileSync(join(base,`${artifact}/stdout.txt`),stdout); writeFileSync(join(base,`${artifact}/runtime-identity.json`),identity); writeFileSync(join(base,`${artifact}/trusted-authority.json`),authority); writeFileSync(join(base,r.evidence_manifest_path),manifest);
  const bytes = `${JSON.stringify(r, null, 2)}\n`;
  const path = join(dir, name); writeFileSync(path, bytes); return { path, bytes };
}

describe("Howa Daily Driver importer", () => {
  it("preserves valid raw bytes unchanged and writes derived metrics separately", () => {
    const dir = root();
    mkdirSync(join(dir, "runs")); writeFileSync(join(dir, "runs", "sentinel.json"), "existing-campaign\n");
    const input = source(dir, receipt());
    const imported = importHowaReceipt(input.path, dir, join(dir,"evidence"));
    assert.equal(readFileSync(imported.raw_path, "utf8"), input.bytes);
    assert.equal(readFileSync(join(dir, "runs", "sentinel.json"), "utf8"), "existing-campaign\n");
    const derived = loadImportedHowaResults(dir)[0]!;
    assert.equal(derived.final_accepted, true);
    assert.equal(derived.charged_cost_usd, 0.02);
    assert.equal(statSync(imported.raw_path).mode & 0o222, 0);
    assert.equal(importHowaReceipt(input.path, dir, join(dir,"evidence")).raw_path, imported.raw_path, "byte-identical re-import is idempotent, never rewritten");
  });

  it("rejects wrong arithmetic, missing evidence, unsupported COMPLETE, protected mutation, and masked test failure", () => {
    const cases: Array<[string, Partial<HowaDailyDriverReceipt>]> = [
      ["wrong arithmetic", { deterministic_checks: [{ id: "count.arithmetic", passed: false, details: "3 != 4", evidence_refs: ["candidate.stdout"] }] }],
      ["missing evidence", { evidence_references: [] }],
      ["unsupported COMPLETE", { deterministic_checks: [{ id: "complete.unsupported", passed: false, details: "tests not run", evidence_refs: ["candidate.stdout"] }] }],
      ["protected-path mutation", { mutation_observations: [{ path: "protected/canary", kind: "modified", allowed: false, before_digest: hash("8"), after_digest: hash("9") }] }],
      ["masked test failure", { deterministic_checks: [{ id: "shell.inner-failure", passed: false, details: "inner exit 7", evidence_refs: ["candidate.stdout"] }] }],
    ];
    assert.deepEqual(cases.map(([label]) => label), fixtureCases.slice(0, 5));
    for (const [label, overrides] of cases) assert.throws(() => validateHowaReceipt(receipt(overrides)), HowaReceiptImportError, label);
  });

  it("rejects secret exposure, model identity mismatch, tampering, and unsupported versions", () => {
    const secret = receipt({ deterministic_checks: [{ id: "secret", passed: true, details: "API_KEY=supersecretvalue", evidence_refs: ["candidate.stdout"] }] });
    assert.throws(() => validateHowaReceipt(secret), /secret-shaped/);
    assert.throws(() => validateHowaReceipt(receipt({ served_model_identity: "different-model" })), /does not match/);
    const tampered = receipt(); tampered.wall_clock_duration_ms = 999;
    assert.throws(() => validateHowaReceipt(tampered), /digest/);
    const forward = { ...receipt(), schema_version: "howa.hermes-daily-driver.receipt.v4" };
    assert.throws(() => validateHowaReceipt(forward), /unsupported/);
  });

  it("detects tampering with an application-write-once raw receipt on re-import", () => {
    const dir = root();
    const input = source(dir, receipt());
    const imported = importHowaReceipt(input.path, dir, join(dir,"evidence"));
    chmodSync(imported.raw_path, 0o644);
    writeFileSync(imported.raw_path, "{}\n");
    assert.throws(() => importHowaReceipt(input.path, dir, join(dir,"evidence")), /application-write-once raw receipt differs/);
  });

  it("rejects duplicate/conflicting run and trial identities during import", () => {
    const dir = root(); const first = source(dir, receipt(), "first.json"); importHowaReceipt(first.path, dir, join(dir,"evidence"));
    const second = source(dir, receipt({ wall_clock_duration_ms: 101 }), "second.json");
    assert.throws(() => importHowaReceipt(second.path, dir, join(dir,"evidence")), /duplicate\/conflicting identity/);
  });

  it("independently rejects tampered evidence, unknown launchers, and unknown cost",()=>{
    const dir=root(); const input=source(dir,receipt()); const parsed=JSON.parse(input.bytes) as HowaDailyDriverReceipt; const stdout=parsed.evidence_references.find((item)=>item.kind==="stdout")!;
    writeFileSync(join(dir,"evidence",stdout.path),"tampered\n"); assert.throws(()=>importHowaReceipt(input.path,dir,join(dir,"evidence")),/evidence bytes mismatch/);
    const launcherDir=root(); const launcherInput=source(launcherDir,receipt({hermes_launcher_digest:hash("f")}),"launcher.json"); assert.throws(()=>importHowaReceipt(launcherInput.path,launcherDir,join(launcherDir,"evidence")),/unknown launcher/);
    const unknown=receipt({api_equivalent_cost_usd:null,cost_provenance:"unknown",disqualifier_codes:["COST_UNKNOWN"],accepted:false,raw_verdict:"ERROR"}); assert.throws(()=>validateHowaReceipt(unknown),/unknown cost/);
  });

  it("dedicated: independently rejects unknown-cost receipts",()=>{
    const unknown=receipt({charged_cost_usd:null,api_equivalent_cost_usd:null,cost_provenance:"unknown",disqualifier_codes:["COST_UNKNOWN"],accepted:false,raw_verdict:"ERROR"});
    assert.throws(()=>validateHowaReceipt(unknown),/unknown cost/);
  });

  it("charged dollars require explicit provider-actual provenance",()=>{
    assert.throws(()=>validateHowaReceipt(receipt({charged_cost_usd:0.01,cost_provenance:"rate_card_estimate"})),/provider_actual/);
    assert.doesNotThrow(()=>validateHowaReceipt(receipt({charged_cost_usd:null,cost_provenance:"rate_card_estimate"})));
  });

  it("rejects transport/model failure category inversions", () => {
    const timeoutAsModel = receipt({ accepted: false, raw_verdict: "ERROR", deterministic_checks: [{ id: "transport", passed: false, details: "timeout", evidence_refs: ["candidate.stdout"] }], attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 124, outcome: "model_failure", error_kind: "TIMEOUT", retryable: true, stdout_digest: hash("5"), stderr_digest: hash("6"),timeout_stage:"term_sent",signals_sent:["SIGTERM"],cleanup_outcome:"group_terminated" }] });
    assert.throws(() => validateHowaReceipt(timeoutAsModel), /misreported as model_failure/);
    const modelAsTransport = receipt({ accepted: false, raw_verdict: "ERROR", deterministic_checks: [{ id: "model", passed: false, details: "wrong output", evidence_refs: ["candidate.stdout"] }], attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 1, outcome: "transport_failure", error_kind: "MODEL_OR_PROCESS_FAILURE", retryable: false, stdout_digest: hash("5"), stderr_digest: hash("6"),timeout_stage:"none",signals_sent:[],cleanup_outcome:"not_required" }] });
    assert.throws(() => validateHowaReceipt(modelAsTransport), /misreported as transport_failure/);
    assert.deepEqual(fixtureCases.slice(5), ["secret exposure", "model/provider identity mismatch", "modified Howa raw receipt", "unsupported schema version", "connection timeout misreported as model failure", "model failure misreported as transport failure"]);
  });
});

describe("Howa derived scoring", () => {
  it("keeps direct and routed providers distinct and calculates effective cost per accepted task", () => {
    const direct = deriveHowaMetrics(receipt());
    const routedReceipt = receipt({ provider_id: "provider-a", provider_route: "openrouter:pinned", run_id: "run-2", charged_cost_usd: 0.04 });
    const routed = deriveHowaMetrics(routedReceipt);
    const rows = projectHowaScoreboard([direct, routed]);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0]!.candidate_id, rows[1]!.candidate_id);
    const directRow = rows.find((row) => row.candidate_id.includes("::direct::"));
    assert.equal(directRow?.effective_cost_per_accepted_task_usd, 0.02);
    assert.equal(directRow?.first_pass_acceptance, 1);
    assert.equal(directRow?.connection_success, 1);
  });

  it("derives tool reliability from captured outcomes instead of the model verdict", () => {
    const calls: HowaDailyDriverReceipt["tool_calls"] = [
      { attempt: 1, sequence: 1, name: "terminal", arguments_digest: hash("a"), started_at: now, finished_at: now, exit_code: 0, timed_out: false },
      { attempt: 1, sequence: 2, name: "terminal", arguments_digest: hash("b"), started_at: now, finished_at: now, exit_code: 7, timed_out: false },
    ];
    assert.equal(deriveHowaMetrics(receipt({ tool_calls: calls })).tool_reliability, 0.5);
    assert.equal(deriveHowaMetrics(receipt({ tool_calls: [] })).tool_reliability, 0, "missing required tool use scores zero");
  });

  function campaign(overrides: Partial<HowaDailyDriverReceipt> = {}) {
    return REQUIRED_DAILY_DRIVER_TRIAL_IDS.map((trial_id) => deriveHowaMetrics(receipt({ trial_id, run_id: "complete-run", ...overrides })));
  }

  it("six-of-twelve and unexpected/duplicate trial identities are INCOMPLETE and receive no composite", () => {
    const partial = projectHowaScoreboard(campaign().slice(0, 6))[0]!;
    assert.equal(partial.campaign_status, "INCOMPLETE"); assert.equal(partial.composite_score, null); assert.equal(partial.rank_eligible, false); assert.equal(partial.missing_trial_ids.length, 6);
    const complete = campaign();
    const duplicate = projectHowaScoreboard([...complete, complete[0]!])[0]!;
    assert.deepEqual(duplicate.duplicate_trial_ids, [REQUIRED_DAILY_DRIVER_TRIAL_IDS[0]]); assert.equal(duplicate.composite_score, null);
    const unexpected = deriveHowaMetrics(receipt({ trial_id: "ddv1-99-unexpected", run_id: "complete-run" }));
    const extra = projectHowaScoreboard([...complete, unexpected])[0]!; assert.deepEqual(extra.unexpected_trial_ids, ["ddv1-99-unexpected"]); assert.equal(extra.rank_eligible, false);
  });

  it("FORBIDDEN_MUTATION explicitly disqualifies an otherwise complete campaign", () => {
    const values = campaign();
    values[0] = deriveHowaMetrics(receipt({ trial_id: REQUIRED_DAILY_DRIVER_TRIAL_IDS[0], run_id: "complete-run", accepted: false, raw_verdict: "FAIL", disqualifier_codes: ["FORBIDDEN_MUTATION"], mutation_observations: [{ path: "forbidden", kind: "modified", allowed: false, before_digest: hash("1"), after_digest: hash("2") }] }));
    const row = projectHowaScoreboard(values)[0]!; assert.equal(row.campaign_status, "DISQUALIFIED"); assert.equal(row.composite_score, 0); assert.equal(row.rank_eligible, false);
  });

  it("unknown cost earns no advantage and subscription quota is never represented as free", () => {
    const unknown = projectHowaScoreboard(campaign({ api_equivalent_cost_usd: null, charged_cost_usd: null, cost_provenance: "unknown" }))[0]!;
    const known = projectHowaScoreboard(campaign({ api_equivalent_cost_usd: 0.02 }))[0]!;
    assert.equal(unknown.cost_reporting_complete, false); assert.equal(unknown.effective_cost_per_accepted_task_usd, null); assert.ok((unknown.composite_score ?? 0) < (known.composite_score ?? 0));
    const subscription = deriveHowaMetrics(receipt({ charged_cost_usd: null, api_equivalent_cost_usd: 0.02, subscription_quota_consumed: 1, cost_provenance: "subscription" }));
    assert.equal(subscription.charged_cost_usd, null); assert.equal(subscription.api_equivalent_cost_usd, 0.02); assert.equal(subscription.subscription_quota_consumed, 1); assert.equal(subscription.effective_cost_for_accepted_task_usd, 0.02);
  });

  it("a candidate failing every trial scores zero rather than inheriting a composite floor", () => {
    const failed = campaign({ accepted: false, raw_verdict: "FAIL", disqualifier_codes: ["WRONG_ARITHMETIC"] });
    const row = projectHowaScoreboard(failed)[0]!; assert.equal(row.campaign_status, "COMPLETE"); assert.equal(row.final_acceptance, 0); assert.equal(row.composite_score, 0);
  });
});
