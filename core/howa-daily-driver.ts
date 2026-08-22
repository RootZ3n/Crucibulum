import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const HOWA_DAILY_DRIVER_SCHEMA = "howa.hermes-daily-driver.receipt.v1" as const;
export const HOWA_DAILY_DRIVER_SUITE = "hermes-daily-driver.v1" as const;

export class HowaReceiptImportError extends Error {
  constructor(readonly issues: string[]) {
    super(`Howa receipt rejected: ${issues.join("; ")}`);
    this.name = "HowaReceiptImportError";
  }
}

export interface HowaAttempt {
  attempt: number; started_at: string; finished_at: string; duration_ms: number; exit_code: number | null;
  outcome: "accepted_output" | "model_failure" | "transport_failure" | "timeout";
  error_kind: string | null; retryable: boolean; stdout_digest: string; stderr_digest: string;
}

export interface HowaCheck { id: string; passed: boolean; details: string; evidence_refs: string[] }

export interface HowaDailyDriverReceipt {
  schema_version: typeof HOWA_DAILY_DRIVER_SCHEMA; receipt_digest: string; trial_id: string;
  trial_suite_version: typeof HOWA_DAILY_DRIVER_SUITE; run_id: string; timestamp: string;
  model_id: string; provider_id: string; provider_route: string; reasoning_level: string;
  served_model_identity: string | null; hermes_version: string; hermes_commit: string;
  hermes_configuration_digest: string; system_prompt_digest: string; tool_registry_digest: string;
  fixture_digest: string; start_timestamp: string; end_timestamp: string; wall_clock_duration_ms: number;
  attempts: HowaAttempt[]; retries: number;
  connection_failures: Array<{ attempt: number; kind: string; timestamp: string; message: string }>;
  timeout_events: Array<{ attempt: number; timestamp: string; timeout_ms: number; phase: "candidate_process" | "validator" }>;
  compaction_events: Array<{ attempt: number; timestamp: string; before_tokens: number | null; after_tokens: number | null }>;
  input_tokens: number | null; output_tokens: number | null; charged_cost_usd: number | null;
  tool_calls: Array<{ attempt: number; sequence: number; name: string; arguments_digest: string; started_at: string; finished_at: string | null; exit_code: number | null; timed_out: boolean }>;
  mutation_observations: Array<{ path: string; kind: "created" | "modified" | "deleted"; allowed: boolean; before_digest: string | null; after_digest: string | null }>;
  deterministic_checks: HowaCheck[];
  raw_verdict: "PASS" | "FAIL" | "SAFE_FAIL" | "INCOMPLETE" | "ERROR";
  evidence_references: Array<{ id: string; kind: "stdout" | "stderr" | "artifact" | "fixture" | "validator"; path: string; digest: string }>;
  correction_rounds: number; accepted: boolean; disqualifier_codes: string[];
}

const TOP_KEYS = [
  "schema_version", "receipt_digest", "trial_id", "trial_suite_version", "run_id", "timestamp", "model_id", "provider_id", "provider_route", "reasoning_level", "served_model_identity", "hermes_version", "hermes_commit", "hermes_configuration_digest", "system_prompt_digest", "tool_registry_digest", "fixture_digest", "start_timestamp", "end_timestamp", "wall_clock_duration_ms", "attempts", "retries", "connection_failures", "timeout_events", "compaction_events", "input_tokens", "output_tokens", "charged_cost_usd", "tool_calls", "mutation_observations", "deterministic_checks", "raw_verdict", "evidence_references", "correction_rounds", "accepted", "disqualifier_codes",
] as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*[^\s,;]{6,})/i;
const SECRET_KEY = /(?:api[_-]?key|authorization|credential|password|private[_-]?key|access[_-]?token|refresh[_-]?token|secret)$/i;
const TRANSPORT_KINDS = new Set(["TIMEOUT", "CONNECTION_RESET", "DNS", "RATE_LIMIT", "UNAVAILABLE", "NETWORK", "HTTP_5XX"]);

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("non-finite number"); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new TypeError(`unsupported JSON value ${typeof value}`);
}
function digest(value: string | Buffer): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
export function computeHowaReceiptDigest(value: Record<string, unknown>): string {
  const { receipt_digest: _discard, ...unsigned } = value;
  return digest(canonical(unsigned));
}

function exact(value: unknown, keys: readonly string[], at: string, issues: string[]): value is Record<string, unknown> {
  if (!record(value)) { issues.push(`${at} must be object`); return false; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) issues.push(`${at}.${key} is not allowed`);
  for (const key of keys) if (!(key in value)) issues.push(`${at}.${key} is required`);
  return true;
}
function string(value: Record<string, unknown>, key: string, at: string, issues: string[], nullable = false): void {
  if (nullable && value[key] === null) return;
  if (typeof value[key] !== "string" || (value[key] as string).length === 0) issues.push(`${at}.${key} must be non-empty string${nullable ? " or null" : ""}`);
}
function nonNegative(value: Record<string, unknown>, key: string, at: string, issues: string[], nullable = false, integer = false): void {
  const item = value[key];
  if (nullable && item === null) return;
  if (typeof item !== "number" || !Number.isFinite(item) || item < 0 || (integer && !Number.isInteger(item))) issues.push(`${at}.${key} must be non-negative ${integer ? "integer" : "number"}${nullable ? " or null" : ""}`);
}
function timestamp(value: Record<string, unknown>, key: string, at: string, issues: string[]): void {
  string(value, key, at, issues);
  if (typeof value[key] === "string" && (!value[key].endsWith("Z") || !Number.isFinite(Date.parse(value[key] as string)))) issues.push(`${at}.${key} must be UTC timestamp`);
}
function hash(value: Record<string, unknown>, key: string, at: string, issues: string[], nullable = false): void {
  if (nullable && value[key] === null) return;
  if (typeof value[key] !== "string" || !DIGEST.test(value[key] as string)) issues.push(`${at}.${key} must be sha256 digest`);
}
function array(value: Record<string, unknown>, key: string, at: string, issues: string[]): unknown[] {
  if (!Array.isArray(value[key])) { issues.push(`${at}.${key} must be array`); return []; }
  return value[key] as unknown[];
}
function scanSecrets(value: unknown, at: string, issues: string[]): void {
  if (typeof value === "string") { if (SECRET_VALUE.test(value)) issues.push(`${at} contains secret-shaped material`); return; }
  if (Array.isArray(value)) { value.forEach((item, index) => scanSecrets(item, `${at}[${index}]`, issues)); return; }
  if (!record(value)) return;
  for (const [key, item] of Object.entries(value)) { if (SECRET_KEY.test(key)) issues.push(`${at}.${key} is forbidden`); scanSecrets(item, `${at}.${key}`, issues); }
}

export function validateHowaReceipt(value: unknown): asserts value is HowaDailyDriverReceipt {
  const issues: string[] = [];
  if (!exact(value, TOP_KEYS, "$", issues)) throw new HowaReceiptImportError(issues);
  const r = value;
  for (const key of ["schema_version", "receipt_digest", "trial_id", "trial_suite_version", "run_id", "model_id", "provider_id", "provider_route", "reasoning_level", "hermes_version", "hermes_commit"] as const) string(r, key, "$", issues);
  if (r.schema_version !== HOWA_DAILY_DRIVER_SCHEMA) issues.push(`$.schema_version unsupported: ${String(r.schema_version)}`);
  if (r.trial_suite_version !== HOWA_DAILY_DRIVER_SUITE) issues.push(`$.trial_suite_version unsupported: ${String(r.trial_suite_version)}`);
  string(r, "served_model_identity", "$", issues, true);
  for (const key of ["receipt_digest", "hermes_configuration_digest", "system_prompt_digest", "tool_registry_digest", "fixture_digest"] as const) hash(r, key, "$", issues);
  for (const key of ["timestamp", "start_timestamp", "end_timestamp"] as const) timestamp(r, key, "$", issues);
  nonNegative(r, "wall_clock_duration_ms", "$", issues); nonNegative(r, "retries", "$", issues, false, true); nonNegative(r, "correction_rounds", "$", issues, false, true);
  for (const key of ["input_tokens", "output_tokens", "charged_cost_usd"] as const) nonNegative(r, key, "$", issues, true);
  if (typeof r.accepted !== "boolean") issues.push("$.accepted must be boolean");
  if (!["PASS", "FAIL", "SAFE_FAIL", "INCOMPLETE", "ERROR"].includes(String(r.raw_verdict))) issues.push("$.raw_verdict invalid");

  const attempts = array(r, "attempts", "$", issues);
  if (attempts.length === 0) issues.push("$.attempts must not be empty");
  attempts.forEach((item, index) => {
    const at = `$.attempts[${index}]`;
    if (!exact(item, ["attempt", "started_at", "finished_at", "duration_ms", "exit_code", "outcome", "error_kind", "retryable", "stdout_digest", "stderr_digest"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); nonNegative(item, "duration_ms", at, issues); timestamp(item, "started_at", at, issues); timestamp(item, "finished_at", at, issues);
    if (item.exit_code !== null && (typeof item.exit_code !== "number" || !Number.isInteger(item.exit_code))) issues.push(`${at}.exit_code invalid`);
    if (!["accepted_output", "model_failure", "transport_failure", "timeout"].includes(String(item.outcome))) issues.push(`${at}.outcome invalid`);
    if (item.error_kind !== null && typeof item.error_kind !== "string") issues.push(`${at}.error_kind invalid`);
    if (typeof item.retryable !== "boolean") issues.push(`${at}.retryable invalid`);
    hash(item, "stdout_digest", at, issues); hash(item, "stderr_digest", at, issues);
    if (item.outcome === "model_failure" && typeof item.error_kind === "string" && TRANSPORT_KINDS.has(item.error_kind)) issues.push(`${at} connection timeout/transport error misreported as model_failure`);
    if ((item.outcome === "transport_failure" || item.outcome === "timeout") && (typeof item.error_kind !== "string" || !TRANSPORT_KINDS.has(item.error_kind))) issues.push(`${at} model/process failure misreported as transport_failure`);
  });
  if (typeof r.retries === "number" && r.retries !== Math.max(0, attempts.length - 1)) issues.push("$.retries must equal attempts.length - 1");

  array(r, "connection_failures", "$", issues).forEach((item, index) => {
    const at = `$.connection_failures[${index}]`;
    if (!exact(item, ["attempt", "kind", "timestamp", "message"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); string(item, "kind", at, issues); timestamp(item, "timestamp", at, issues); string(item, "message", at, issues);
    if (typeof item.kind === "string" && !TRANSPORT_KINDS.has(item.kind)) issues.push(`${at}.kind is not a transport failure`);
  });
  array(r, "timeout_events", "$", issues).forEach((item, index) => {
    const at = `$.timeout_events[${index}]`;
    if (!exact(item, ["attempt", "timestamp", "timeout_ms", "phase"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); timestamp(item, "timestamp", at, issues); nonNegative(item, "timeout_ms", at, issues);
    if (!["candidate_process", "validator"].includes(String(item.phase))) issues.push(`${at}.phase invalid`);
  });
  array(r, "compaction_events", "$", issues).forEach((item, index) => {
    const at = `$.compaction_events[${index}]`;
    if (!exact(item, ["attempt", "timestamp", "before_tokens", "after_tokens"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); timestamp(item, "timestamp", at, issues); nonNegative(item, "before_tokens", at, issues, true); nonNegative(item, "after_tokens", at, issues, true);
  });
  array(r, "tool_calls", "$", issues).forEach((item, index) => {
    const at = `$.tool_calls[${index}]`;
    if (!exact(item, ["attempt", "sequence", "name", "arguments_digest", "started_at", "finished_at", "exit_code", "timed_out"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); nonNegative(item, "sequence", at, issues, false, true); string(item, "name", at, issues); hash(item, "arguments_digest", at, issues); timestamp(item, "started_at", at, issues);
    if (item.finished_at !== null) timestamp(item, "finished_at", at, issues);
    if (item.exit_code !== null && (typeof item.exit_code !== "number" || !Number.isInteger(item.exit_code))) issues.push(`${at}.exit_code invalid`);
    if (typeof item.timed_out !== "boolean") issues.push(`${at}.timed_out invalid`);
  });
  const mutations = array(r, "mutation_observations", "$", issues);
  mutations.forEach((item, index) => {
    const at = `$.mutation_observations[${index}]`;
    if (!exact(item, ["path", "kind", "allowed", "before_digest", "after_digest"], at, issues)) return;
    string(item, "path", at, issues); if (!["created", "modified", "deleted"].includes(String(item.kind))) issues.push(`${at}.kind invalid`);
    if (typeof item.allowed !== "boolean") issues.push(`${at}.allowed invalid`); hash(item, "before_digest", at, issues, true); hash(item, "after_digest", at, issues, true);
  });
  const checks = array(r, "deterministic_checks", "$", issues);
  if (checks.length === 0) issues.push("$.deterministic_checks must not be empty");
  checks.forEach((item, index) => {
    const at = `$.deterministic_checks[${index}]`;
    if (!exact(item, ["id", "passed", "details", "evidence_refs"], at, issues)) return;
    string(item, "id", at, issues); string(item, "details", at, issues); if (typeof item.passed !== "boolean") issues.push(`${at}.passed invalid`);
    array(item, "evidence_refs", at, issues).forEach((ref, n) => { if (typeof ref !== "string") issues.push(`${at}.evidence_refs[${n}] invalid`); });
  });
  const evidence = array(r, "evidence_references", "$", issues);
  evidence.forEach((item, index) => {
    const at = `$.evidence_references[${index}]`;
    if (!exact(item, ["id", "kind", "path", "digest"], at, issues)) return;
    string(item, "id", at, issues); string(item, "path", at, issues); hash(item, "digest", at, issues);
    if (!["stdout", "stderr", "artifact", "fixture", "validator"].includes(String(item.kind))) issues.push(`${at}.kind invalid`);
    if (typeof item.path === "string" && (isAbsolute(item.path) || item.path.split(/[\\/]/).includes(".."))) issues.push(`${at}.path unsafe`);
  });
  const codes = array(r, "disqualifier_codes", "$", issues);
  codes.forEach((code, index) => { if (typeof code !== "string" || !CODE.test(code)) issues.push(`$.disqualifier_codes[${index}] invalid`); });
  if (r.accepted === true && r.raw_verdict !== "PASS") issues.push("$.accepted requires raw_verdict PASS");
  if (r.accepted === true && codes.length > 0) issues.push("$.accepted cannot carry disqualifiers");
  if (r.accepted === true && checks.some((item) => record(item) && item.passed !== true)) issues.push("$.accepted cannot contain failed deterministic checks");
  if (r.accepted === true && mutations.some((item) => record(item) && item.allowed !== true)) issues.push("$.accepted cannot contain forbidden mutation");
  if (r.accepted === true && evidence.length === 0) issues.push("$.accepted requires evidence references");
  if (r.accepted === true && (r.served_model_identity === null || r.served_model_identity !== r.model_id)) issues.push("$.served_model_identity does not match bound model_id");
  const evidenceIds = new Set(evidence.filter(record).map((item) => item.id).filter((id): id is string => typeof id === "string"));
  checks.forEach((item, index) => {
    if (!record(item) || !Array.isArray(item.evidence_refs)) return;
    item.evidence_refs.forEach((ref, refIndex) => { if (typeof ref === "string" && !evidenceIds.has(ref)) issues.push(`$.deterministic_checks[${index}].evidence_refs[${refIndex}] does not identify exported evidence`); });
  });
  scanSecrets(r, "$", issues);
  if (typeof r.receipt_digest === "string" && DIGEST.test(r.receipt_digest) && computeHowaReceiptDigest(r) !== r.receipt_digest) issues.push("$.receipt_digest does not match canonical raw verdict receipt");
  if (issues.length > 0) throw new HowaReceiptImportError(issues);
}

function safeInside(root: string, child: string): string {
  const target = resolve(root, child);
  const rel = relative(resolve(root), target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return target;
  throw new Error(`path escapes import store: ${child}`);
}

function writeOnce(filePath: string, bytes: string | Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const fd = openSync(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o444);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}

export function importHowaReceipt(sourcePath: string, storeRoot: string): { receipt: HowaDailyDriverReceipt; raw_path: string } {
  const rawBytes = readFileSync(sourcePath);
  let parsed: unknown;
  try { parsed = JSON.parse(rawBytes.toString("utf8")); } catch (error) { throw new HowaReceiptImportError([`invalid JSON: ${String(error)}`]); }
  validateHowaReceipt(parsed);
  const receipt = parsed;
  const digestName = receipt.receipt_digest.slice(7);
  const rawPath = safeInside(storeRoot, join("howa-imports", "raw", `${digestName}.json`));
  if (existsSync(rawPath)) {
    const existing = readFileSync(rawPath);
    if (!existing.equals(rawBytes)) throw new HowaReceiptImportError(["existing immutable raw receipt differs byte-for-byte"]);
  } else {
    writeOnce(rawPath, rawBytes);
  }
  return { receipt, raw_path: rawPath };
}
