import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
import { deriveHowaMetrics, loadImportedHowaResults, projectHowaScoreboard } from "../core/howa-daily-driver-scoring.js";

const now = "2026-08-22T12:00:00.000Z";
const hash = (char: string) => `sha256:${char.repeat(64)}`;
const fixtureCases = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "howa-daily-driver-negative-cases.json"), "utf8")) as string[];

function receipt(overrides: Partial<HowaDailyDriverReceipt> = {}): HowaDailyDriverReceipt {
  const value: HowaDailyDriverReceipt = {
    schema_version: "howa.hermes-daily-driver.receipt.v1", receipt_digest: hash("0"), trial_id: "ddv1-01-porcelain-parser", trial_suite_version: "hermes-daily-driver.v1", run_id: "run-1", timestamp: now,
    model_id: "model-a", provider_id: "provider-a", provider_route: "direct", reasoning_level: "max", served_model_identity: "model-a",
    hermes_version: "1", hermes_commit: "abc", hermes_configuration_digest: hash("1"), system_prompt_digest: hash("2"), tool_registry_digest: hash("3"), fixture_digest: hash("4"),
    start_timestamp: now, end_timestamp: now, wall_clock_duration_ms: 100,
    attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 0, outcome: "accepted_output", error_kind: null, retryable: false, stdout_digest: hash("5"), stderr_digest: hash("6") }],
    retries: 0, connection_failures: [], timeout_events: [], compaction_events: [], input_tokens: 10, output_tokens: 5, charged_cost_usd: 0.02,
    tool_calls: [], mutation_observations: [], deterministic_checks: [{ id: "porcelain.evidence", passed: true, details: "verified", evidence_refs: ["candidate.stdout"] }],
    raw_verdict: "PASS", evidence_references: [{ id: "candidate.stdout", kind: "stdout", path: "artifacts/stdout.txt", digest: hash("7") }], correction_rounds: 0, accepted: true, disqualifier_codes: [],
    ...overrides,
  };
  value.receipt_digest = computeHowaReceiptDigest(value as unknown as Record<string, unknown>);
  return value;
}

function root(): string { return mkdtempSync(join(tmpdir(), "luak-howa-import-")); }
function source(dir: string, value: unknown, name = "receipt.json"): { path: string; bytes: string } {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  const path = join(dir, name); writeFileSync(path, bytes); return { path, bytes };
}

describe("Howa Daily Driver importer", () => {
  it("preserves valid raw bytes unchanged and writes derived metrics separately", () => {
    const dir = root();
    mkdirSync(join(dir, "runs")); writeFileSync(join(dir, "runs", "sentinel.json"), "existing-campaign\n");
    const input = source(dir, receipt());
    const imported = importHowaReceipt(input.path, dir);
    assert.equal(readFileSync(imported.raw_path, "utf8"), input.bytes);
    assert.equal(readFileSync(join(dir, "runs", "sentinel.json"), "utf8"), "existing-campaign\n");
    const derived = loadImportedHowaResults(dir)[0]!;
    assert.equal(derived.final_accepted, true);
    assert.equal(derived.raw_cost_usd, 0.02);
    assert.equal(statSync(imported.raw_path).mode & 0o222, 0);
    assert.equal(importHowaReceipt(input.path, dir).raw_path, imported.raw_path, "byte-identical re-import is idempotent, never rewritten");
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
    const forward = { ...receipt(), schema_version: "howa.hermes-daily-driver.receipt.v2" };
    assert.throws(() => validateHowaReceipt(forward), /unsupported/);
  });

  it("detects a modified immutable raw receipt on re-import", () => {
    const dir = root();
    const input = source(dir, receipt());
    const imported = importHowaReceipt(input.path, dir);
    chmodSync(imported.raw_path, 0o644);
    writeFileSync(imported.raw_path, "{}\n");
    assert.throws(() => importHowaReceipt(input.path, dir), /existing immutable raw receipt differs/);
  });

  it("rejects transport/model failure category inversions", () => {
    const timeoutAsModel = receipt({ accepted: false, raw_verdict: "ERROR", deterministic_checks: [{ id: "transport", passed: false, details: "timeout", evidence_refs: ["candidate.stdout"] }], attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 124, outcome: "model_failure", error_kind: "TIMEOUT", retryable: true, stdout_digest: hash("5"), stderr_digest: hash("6") }] });
    assert.throws(() => validateHowaReceipt(timeoutAsModel), /misreported as model_failure/);
    const modelAsTransport = receipt({ accepted: false, raw_verdict: "ERROR", deterministic_checks: [{ id: "model", passed: false, details: "wrong output", evidence_refs: ["candidate.stdout"] }], attempts: [{ attempt: 1, started_at: now, finished_at: now, duration_ms: 100, exit_code: 1, outcome: "transport_failure", error_kind: "MODEL_OR_PROCESS_FAILURE", retryable: false, stdout_digest: hash("5"), stderr_digest: hash("6") }] });
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
  });
});
