import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { validateCommittedHowaSchema } from "./json-schema-runtime.js";

export const HOWA_DAILY_DRIVER_SCHEMA = "howa.hermes-daily-driver.receipt.v3" as const;
export const HOWA_DAILY_DRIVER_RATE_CARD = "howa.ddv1-rates.2026-08-22.1" as const;
export const HOWA_DAILY_DRIVER_RUNTIME_POLICY = "howa.ddv1-runtime.2026-08-22.2" as const;
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
  timeout_stage: "none"|"term_sent"|"kill_sent"|"drain_bounded"; signals_sent: Array<"SIGTERM"|"SIGKILL">; cleanup_outcome:"not_required"|"group_terminated"|"group_killed"|"cleanup_unconfirmed";
}

export interface HowaCheck { id: string; passed: boolean; details: string; evidence_refs: string[] }

export interface HowaDailyDriverReceipt {
  schema_version: typeof HOWA_DAILY_DRIVER_SCHEMA; receipt_digest: string; trial_id: string;
  trial_suite_version: typeof HOWA_DAILY_DRIVER_SUITE; run_id: string; timestamp: string;
  model_id: string; provider_id: string; provider_route: string; reasoning_level: string;
  served_model_identity: string | null; hermes_version: string; hermes_commit: string;
  hermes_launcher_digest: string; terminal_sandbox_digest:string; runtime_policy_version:string; runtime_policy_digest:string; hermes_executable_digest: string; hermes_arguments: string[]; requested_temperature: number | null;
  hermes_configuration_digest: string; system_prompt_digest: string; tool_registry_digest: string;
  fixture_digest: string; campaign_entropy_commitment:string; start_timestamp: string; end_timestamp: string; wall_clock_duration_ms: number;
  attempts: HowaAttempt[]; retries: number;
  connection_failures: Array<{ attempt: number; kind: string; timestamp: string; message: string }>;
  timeout_events: Array<{ attempt: number; timestamp: string; timeout_ms: number; phase: "candidate_process" | "validator"; stage:"term_sent"|"kill_sent"|"drain_bounded"; signals_sent:Array<"SIGTERM"|"SIGKILL">; cleanup_outcome:"group_terminated"|"group_killed"|"cleanup_unconfirmed" }>;
  compaction_events: Array<{ attempt: number; timestamp: string; before_tokens: number | null; after_tokens: number | null }>;
  input_tokens: number | null; output_tokens: number | null; charged_cost_usd: number | null; api_equivalent_cost_usd: number | null;
  plan_credit_consumed: number | null; subscription_quota_consumed: number | null; cost_rate_card_version: string;
  cost_provenance: "provider_actual" | "rate_card_estimate" | "subscription" | "token_plan" | "unknown";
  candidate_accommodations: string[]; max_turns: number; max_output_tokens: number; limits_enforcement: "enforced" | "post_hoc";
  tool_calls: Array<{ attempt: number; sequence: number; name: string; arguments_digest: string; started_at: string; finished_at: string | null; exit_code: number | null; timed_out: boolean }>;
  mutation_observations: Array<{ path: string; kind: "created" | "modified" | "deleted"; allowed: boolean; before_digest: string | null; after_digest: string | null }>;
  deterministic_checks: HowaCheck[];
  raw_verdict: "PASS" | "FAIL" | "SAFE_FAIL" | "INCOMPLETE" | "ERROR";
  evidence_references: Array<{ id: string; kind: "stdout" | "stderr" | "artifact" | "fixture" | "validator"; path: string; digest: string }>;
  evidence_manifest_path:string; evidence_manifest_digest:string; evidence_bundle_mode:"receipt-plus-evidence-directory";
  redaction_events:Array<{source:string;kind:string;classification:"confirmed_secret"|"possible_sensitive";match_digest:string}>;
  correction_rounds: number; accepted: boolean; disqualifier_codes: string[];
}

const TOP_KEYS = [
  "schema_version", "receipt_digest", "trial_id", "trial_suite_version", "run_id", "timestamp", "model_id", "provider_id", "provider_route", "reasoning_level", "served_model_identity", "hermes_version", "hermes_commit", "hermes_launcher_digest", "terminal_sandbox_digest", "runtime_policy_version", "runtime_policy_digest", "hermes_executable_digest", "hermes_arguments", "requested_temperature", "hermes_configuration_digest", "system_prompt_digest", "tool_registry_digest", "fixture_digest", "campaign_entropy_commitment", "start_timestamp", "end_timestamp", "wall_clock_duration_ms", "attempts", "retries", "connection_failures", "timeout_events", "compaction_events", "input_tokens", "output_tokens", "charged_cost_usd", "api_equivalent_cost_usd", "plan_credit_consumed", "subscription_quota_consumed", "cost_rate_card_version", "cost_provenance", "candidate_accommodations", "max_turns", "max_output_tokens", "limits_enforcement", "tool_calls", "mutation_observations", "deterministic_checks", "raw_verdict", "evidence_references", "evidence_manifest_path", "evidence_manifest_digest", "evidence_bundle_mode", "redaction_events", "correction_rounds", "accepted", "disqualifier_codes",
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
  const issues: string[] = validateCommittedHowaSchema(value).map((issue) => `JSON Schema ${issue}`);
  if (!exact(value, TOP_KEYS, "$", issues)) throw new HowaReceiptImportError(issues);
  const r = value;
  for (const key of ["schema_version", "receipt_digest", "trial_id", "trial_suite_version", "run_id", "model_id", "provider_id", "provider_route", "reasoning_level", "hermes_version", "hermes_commit", "runtime_policy_version", "cost_rate_card_version", "evidence_manifest_path", "evidence_bundle_mode"] as const) string(r, key, "$", issues);
  if (r.schema_version !== HOWA_DAILY_DRIVER_SCHEMA) issues.push(`$.schema_version unsupported: ${String(r.schema_version)}`);
  if (r.trial_suite_version !== HOWA_DAILY_DRIVER_SUITE) issues.push(`$.trial_suite_version unsupported: ${String(r.trial_suite_version)}`);
  if(r.cost_rate_card_version!==HOWA_DAILY_DRIVER_RATE_CARD) issues.push(`$.cost_rate_card_version unsupported: ${String(r.cost_rate_card_version)}`);
  if(r.runtime_policy_version!==HOWA_DAILY_DRIVER_RUNTIME_POLICY) issues.push(`$.runtime_policy_version unsupported: ${String(r.runtime_policy_version)}`);
  if(r.evidence_bundle_mode!=="receipt-plus-evidence-directory") issues.push("$.evidence_bundle_mode unsupported");
  string(r, "served_model_identity", "$", issues, true);
  for (const key of ["receipt_digest", "hermes_launcher_digest", "terminal_sandbox_digest", "runtime_policy_digest", "hermes_executable_digest", "hermes_configuration_digest", "system_prompt_digest", "tool_registry_digest", "fixture_digest", "campaign_entropy_commitment", "evidence_manifest_digest"] as const) hash(r, key, "$", issues);
  if(r.hermes_launcher_digest===r.terminal_sandbox_digest) issues.push("$.terminal_sandbox_digest aliases launcher digest");
  array(r, "hermes_arguments", "$", issues).forEach((item, index) => { if (typeof item !== "string") issues.push(`$.hermes_arguments[${index}] invalid`); });
  nonNegative(r, "requested_temperature", "$", issues, true);
  for (const key of ["timestamp", "start_timestamp", "end_timestamp"] as const) timestamp(r, key, "$", issues);
  nonNegative(r, "wall_clock_duration_ms", "$", issues); nonNegative(r, "retries", "$", issues, false, true); nonNegative(r, "correction_rounds", "$", issues, false, true);
  for (const key of ["input_tokens", "output_tokens"] as const) nonNegative(r, key, "$", issues, true, true);
  for (const key of ["charged_cost_usd", "api_equivalent_cost_usd", "plan_credit_consumed", "subscription_quota_consumed"] as const) nonNegative(r, key, "$", issues, true);
  for (const key of ["max_turns", "max_output_tokens"] as const) nonNegative(r, key, "$", issues, false, true);
  if (typeof r.max_turns === "number" && r.max_turns < 1) issues.push("$.max_turns must be >= 1");
  if (typeof r.max_output_tokens === "number" && r.max_output_tokens < 1) issues.push("$.max_output_tokens must be >= 1");
  if (!["provider_actual", "rate_card_estimate", "subscription", "token_plan", "unknown"].includes(String(r.cost_provenance))) issues.push("$.cost_provenance invalid");
  if(r.cost_provenance==="unknown"||r.api_equivalent_cost_usd===null||Array.isArray(r.disqualifier_codes)&&r.disqualifier_codes.includes("COST_UNKNOWN")) issues.push("unknown cost receipts are not importable");
  if(r.cost_provenance==="subscription"&&r.subscription_quota_consumed===null) issues.push("subscription cost requires quota consumption");
  if (!["enforced", "post_hoc"].includes(String(r.limits_enforcement))) issues.push("$.limits_enforcement invalid");
  array(r, "candidate_accommodations", "$", issues).forEach((item, index) => { if (typeof item !== "string" || item.length === 0) issues.push(`$.candidate_accommodations[${index}] invalid`); });
  if (typeof r.accepted !== "boolean") issues.push("$.accepted must be boolean");
  if (!["PASS", "FAIL", "SAFE_FAIL", "INCOMPLETE", "ERROR"].includes(String(r.raw_verdict))) issues.push("$.raw_verdict invalid");

  const attempts = array(r, "attempts", "$", issues);
  if (attempts.length === 0) issues.push("$.attempts must not be empty");
  attempts.forEach((item, index) => {
    const at = `$.attempts[${index}]`;
    if (!exact(item, ["attempt", "started_at", "finished_at", "duration_ms", "exit_code", "outcome", "error_kind", "retryable", "stdout_digest", "stderr_digest", "timeout_stage", "signals_sent", "cleanup_outcome"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); nonNegative(item, "duration_ms", at, issues); timestamp(item, "started_at", at, issues); timestamp(item, "finished_at", at, issues);
    if (item.exit_code !== null && (typeof item.exit_code !== "number" || !Number.isInteger(item.exit_code))) issues.push(`${at}.exit_code invalid`);
    if (!["accepted_output", "model_failure", "transport_failure", "timeout"].includes(String(item.outcome))) issues.push(`${at}.outcome invalid`);
    if (item.error_kind !== null && typeof item.error_kind !== "string") issues.push(`${at}.error_kind invalid`);
    if (typeof item.retryable !== "boolean") issues.push(`${at}.retryable invalid`);
    hash(item, "stdout_digest", at, issues); hash(item, "stderr_digest", at, issues);
    if(!["none","term_sent","kill_sent","drain_bounded"].includes(String(item.timeout_stage))) issues.push(`${at}.timeout_stage invalid`);
    array(item,"signals_sent",at,issues); if(!["not_required","group_terminated","group_killed","cleanup_unconfirmed"].includes(String(item.cleanup_outcome))) issues.push(`${at}.cleanup_outcome invalid`);
    if (item.attempt !== index + 1) issues.push(`${at}.attempt must be contiguous and one-based`);
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
    if (!exact(item, ["attempt", "timestamp", "timeout_ms", "phase", "stage", "signals_sent", "cleanup_outcome"], at, issues)) return;
    nonNegative(item, "attempt", at, issues, false, true); timestamp(item, "timestamp", at, issues); nonNegative(item, "timeout_ms", at, issues);
    if (!["candidate_process", "validator"].includes(String(item.phase))) issues.push(`${at}.phase invalid`);
    if(!["term_sent","kill_sent","drain_bounded"].includes(String(item.stage))) issues.push(`${at}.stage invalid`); array(item,"signals_sent",at,issues); if(!["group_terminated","group_killed","cleanup_unconfirmed"].includes(String(item.cleanup_outcome))) issues.push(`${at}.cleanup_outcome invalid`);
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
  array(r,"redaction_events","$",issues).forEach((item,index)=>{const at=`$.redaction_events[${index}]`;if(!exact(item,["source","kind","classification","match_digest"],at,issues))return;string(item,"source",at,issues);string(item,"kind",at,issues);hash(item,"match_digest",at,issues);if(!["confirmed_secret","possible_sensitive"].includes(String(item.classification)))issues.push(`${at}.classification invalid`);});
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

interface EvidenceManifestEntry {path:string;byte_length:number;digest:string;evidence_class:string;run_id:string;trial_id:string}
interface EvidenceManifest {schema_version:string;run_id:string;trial_id:string;entries:EvidenceManifestEntry[]}
function evidencePath(root:string,relativePath:string):string{if(isAbsolute(relativePath)||relativePath.split(/[\\/]/).some((part)=>part===""||part==="."||part===".."))throw new HowaReceiptImportError([`unsafe evidence path ${relativePath}`]);return safeInside(root,relativePath);}
function walkRelative(root:string,dir=root):string[]{const out:string[]=[];for(const entry of readdirSync(dir,{withFileTypes:true})){const full=join(dir,entry.name);if(entry.isSymbolicLink())throw new HowaReceiptImportError([`symlink in evidence scope: ${full}`]);if(entry.isDirectory())out.push(...walkRelative(root,full));else if(entry.isFile())out.push(relative(root,full).split(sep).join("/"));else throw new HowaReceiptImportError([`non-file evidence entry: ${full}`]);}return out.sort();}
function runtimePolicy():{policy_version:string;identities:Array<{kind:string;launcher_digest:string;terminal_sandbox_digest:string;executable_digest:string;policy_digest:string}>}{for(const url of [new URL("../contracts/howa-ddv1-runtime-policy.v2.json",import.meta.url),new URL("../../contracts/howa-ddv1-runtime-policy.v2.json",import.meta.url)]){try{return JSON.parse(readFileSync(url,"utf8"));}catch{}}throw new HowaReceiptImportError(["committed Howa runtime policy unavailable"]);}
export function verifyHowaEvidenceBundle(receipt:HowaDailyDriverReceipt,evidenceRoot:string):{manifest:EvidenceManifest;manifest_bytes:Buffer}{validateHowaReceipt(receipt);const manifestTarget=evidencePath(evidenceRoot,receipt.evidence_manifest_path);const mi=lstatSync(manifestTarget);if(!mi.isFile()||mi.isSymbolicLink())throw new HowaReceiptImportError(["manifest is not a regular file"]);const manifestBytes=readFileSync(manifestTarget);if(digest(manifestBytes)!==receipt.evidence_manifest_digest)throw new HowaReceiptImportError(["evidence manifest digest mismatch"]);const manifest=JSON.parse(manifestBytes.toString("utf8")) as EvidenceManifest;if(manifest.schema_version!=="howa.hermes-daily-driver.evidence-manifest.v1"||manifest.run_id!==receipt.run_id||manifest.trial_id!==receipt.trial_id||!Array.isArray(manifest.entries))throw new HowaReceiptImportError(["evidence manifest schema/identity mismatch"]);const refs=new Map(receipt.evidence_references.map((ref)=>[ref.path,ref]));if(refs.size!==receipt.evidence_references.length)throw new HowaReceiptImportError(["duplicate receipt evidence path"]);const seen=new Set<string>();for(const entry of manifest.entries){const target=evidencePath(evidenceRoot,entry.path);if(seen.has(entry.path))throw new HowaReceiptImportError([`duplicate manifest path ${entry.path}`]);seen.add(entry.path);const ref=refs.get(entry.path);if(!ref||ref.digest!==entry.digest||ref.kind!==entry.evidence_class||entry.run_id!==receipt.run_id||entry.trial_id!==receipt.trial_id)throw new HowaReceiptImportError([`manifest/reference mismatch ${entry.path}`]);const info=lstatSync(target);if(!info.isFile()||info.isSymbolicLink())throw new HowaReceiptImportError([`invalid evidence file ${entry.path}`]);const bytes=readFileSync(target);if(bytes.length!==entry.byte_length||digest(bytes)!==entry.digest)throw new HowaReceiptImportError([`evidence bytes mismatch ${entry.path}`]);}if(seen.size!==refs.size)throw new HowaReceiptImportError(["manifest omits receipt evidence"]);const artifactPrefix=`artifacts/${receipt.run_id}/${receipt.trial_id}/`;const actual=walkRelative(evidencePath(evidenceRoot,artifactPrefix.slice(0,-1))).map((item)=>artifactPrefix+item);const declared=[...seen].filter((item)=>item.startsWith(artifactPrefix)).sort();if(canonical(actual)!==canonical(declared))throw new HowaReceiptImportError(["evidence directory has missing, extra, or renamed files"]);const identityRef=receipt.evidence_references.find((ref)=>ref.path.endsWith("runtime-identity.json"));if(!identityRef)throw new HowaReceiptImportError(["runtime identity evidence missing"]);const identity=JSON.parse(readFileSync(evidencePath(evidenceRoot,identityRef.path),"utf8")) as Record<string,unknown>;for(const key of ["hermes_launcher_digest","terminal_sandbox_digest","hermes_executable_digest","runtime_policy_version","runtime_policy_digest","hermes_configuration_digest","system_prompt_digest","tool_registry_digest","cost_rate_card_version","campaign_entropy_commitment"] as const)if(identity[key]!==receipt[key])throw new HowaReceiptImportError([`runtime identity mismatch ${key}`]);const policy=runtimePolicy();const kind=receipt.provider_id==="offline"?"offline-proof":"production-hermes";if(policy.policy_version!==receipt.runtime_policy_version||!policy.identities.some((item)=>item.kind===kind&&item.launcher_digest===receipt.hermes_launcher_digest&&item.terminal_sandbox_digest===receipt.terminal_sandbox_digest&&item.executable_digest===receipt.hermes_executable_digest&&item.policy_digest===receipt.runtime_policy_digest))throw new HowaReceiptImportError(["unknown launcher/sandbox/executable policy identity"]);return{manifest,manifest_bytes:manifestBytes};}

function verifyCampaignAuthority(receipt:HowaDailyDriverReceipt,evidenceRoot:string):void{const ref=receipt.evidence_references.find((item)=>item.path.endsWith("trusted-authority.json"));if(!ref)throw new HowaReceiptImportError(["trusted campaign authority missing"]);const authority=JSON.parse(readFileSync(evidencePath(evidenceRoot,ref.path),"utf8")) as Record<string,unknown>;if(authority.run_id!==receipt.run_id||authority.trial_id!==receipt.trial_id||authority.fixture_digest!==receipt.fixture_digest||authority.entropy_commitment!==receipt.campaign_entropy_commitment||typeof authority.nonce_hex!=="string"||!/^[a-f0-9]{64}$/.test(authority.nonce_hex))throw new HowaReceiptImportError(["trusted campaign authority mismatch"]);const commitment=digest(Buffer.concat([Buffer.from("howa-ddv1-entropy-commitment\0"),Buffer.from(authority.nonce_hex,"hex")]));if(commitment!==receipt.campaign_entropy_commitment)throw new HowaReceiptImportError(["campaign entropy commitment mismatch"]);}

export function importHowaReceipt(sourcePath: string, storeRoot: string, evidenceRoot: string): { receipt: HowaDailyDriverReceipt; raw_path: string; evidence_path:string } {
  const rawBytes = readFileSync(sourcePath);
  let parsed: unknown;
  try { parsed = JSON.parse(rawBytes.toString("utf8")); } catch (error) { throw new HowaReceiptImportError([`invalid JSON: ${String(error)}`]); }
  validateHowaReceipt(parsed);
  const receipt = parsed;
  const verified=verifyHowaEvidenceBundle(receipt,evidenceRoot); verifyCampaignAuthority(receipt,evidenceRoot);
  const digestName = receipt.receipt_digest.slice(7);
  const rawPath = safeInside(storeRoot, join("howa-imports", "raw", `${digestName}.json`));
  const rawDir = safeInside(storeRoot, join("howa-imports", "raw"));
  if (existsSync(rawDir)) for (const name of readdirSync(rawDir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name) || join(rawDir, name) === rawPath) continue;
    const existingReceipt = JSON.parse(readFileSync(join(rawDir, name), "utf8")) as Record<string, unknown>;
    if (existingReceipt.run_id === receipt.run_id && existingReceipt.trial_id === receipt.trial_id) throw new HowaReceiptImportError([`duplicate/conflicting identity (${receipt.run_id}, ${receipt.trial_id})`]);
  }
  if (existsSync(rawPath)) {
    const existing = readFileSync(rawPath);
    if (!existing.equals(rawBytes)) throw new HowaReceiptImportError(["existing application-write-once raw receipt differs byte-for-byte"]);
  } else {
    writeOnce(rawPath, rawBytes);
  }
  const evidenceStore=safeInside(storeRoot,join("howa-imports","evidence",digestName));
  for(const entry of verified.manifest.entries){const target=safeInside(evidenceStore,entry.path);const bytes=readFileSync(evidencePath(evidenceRoot,entry.path));if(existsSync(target)){if(!readFileSync(target).equals(bytes))throw new HowaReceiptImportError([`stored evidence differs ${entry.path}`]);}else writeOnce(target,bytes);}
  const storedManifest=safeInside(evidenceStore,receipt.evidence_manifest_path);if(!existsSync(storedManifest))writeOnce(storedManifest,verified.manifest_bytes);
  return { receipt, raw_path: rawPath, evidence_path:evidenceStore };
}
