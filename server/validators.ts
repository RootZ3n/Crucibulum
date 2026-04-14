/**
 * Crucibulum — Runtime request-body validation
 *
 * Tiny, dependency-free validators for the handful of POST routes that accept
 * structured payloads. Intentionally not a generic schema framework — every
 * route already has a TypeScript shape, and these validators exist only so
 * malformed runtime input fails fast with a clear 400 instead of sneaking
 * past compile-time types and silently coercing.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// ── Public request shapes ────────────────────────────────────────────────────

export interface RunRequest {
  task: string;
  model: string;
  adapter: string;
  provider: string | null;
  count: number;
  secondOpinion?: { enabled?: boolean; provider?: string; model?: string };
  qcReview?: { enabled?: boolean; provider?: string; model?: string };
}

export interface RunSuiteRequest {
  model: string;
  adapter: string;
  provider: string | null;
  suite_id?: string;
  flake_detection?: { enabled?: boolean; retries?: number };
  secondOpinion?: { enabled?: boolean; provider?: string; model?: string };
  qcReview?: { enabled?: boolean; provider?: string; model?: string };
}

export interface RunBatchRequest {
  task: string;
  models: Array<{ adapter: string; provider: string | null; model: string }>;
  auto_synthesis: boolean;
  secondOpinion?: { enabled?: boolean; provider?: string; model?: string };
  qcReview?: { enabled?: boolean; provider?: string; model?: string };
}

export interface ScoresSyncRequest {
  scores: ScoreRow[];
  source: string;
  runId?: string;
}

export interface ScoreRow {
  modelId: string;
  taskId: string;
  family: string;
  category: string;
  passed: boolean;
  score: number;
  rawScore: number;
  duration_ms: number;
  timestamp: string;
  tokensUsed?: number;
  costEstimate?: number;
  anomalyFlags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SynthesisRequest {
  run_ids?: string[];
  task_id?: string;
}

export interface CrucibleLinkRequest {
  profile_id: string | null;
  benchmark_score: number | null;
  benchmark_label: string | null;
}

// ── Validators ───────────────────────────────────────────────────────────────

const VALID_SCORE_FAMILIES = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
const VALID_SCORE_SOURCES = new Set(["crucible", "crucibulum", "veritor", "verum"]);

export function validateRunRequest(raw: unknown): ValidationResult<RunRequest> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;

  if (!isNonEmptyString(b["task"])) errors.push("task: must be a non-empty string");
  if (!isNonEmptyString(b["model"])) errors.push("model: must be a non-empty string");
  const adapter = b["adapter"] ?? b["providerId"];
  if (!isNonEmptyString(adapter)) errors.push("adapter (or providerId): must be a non-empty string");

  let count = 1;
  if (b["count"] !== undefined) {
    if (!isFiniteNumber(b["count"]) || Math.floor(b["count"]) < 1) {
      errors.push("count: must be an integer >= 1");
    } else {
      count = Math.min(Math.floor(b["count"]), 10);
    }
  }

  const provider = b["provider"] === undefined || b["provider"] === null ? null : (typeof b["provider"] === "string" ? b["provider"] : null);

  const secondOpinion = validateReviewConfig(b["secondOpinion"], "secondOpinion", errors);
  const qcReview = validateReviewConfig(b["qcReview"], "qcReview", errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      task: b["task"] as string,
      model: b["model"] as string,
      adapter: adapter as string,
      provider,
      count,
      ...(secondOpinion ? { secondOpinion } : {}),
      ...(qcReview ? { qcReview } : {}),
    },
  };
}

export function validateRunSuiteRequest(raw: unknown): ValidationResult<RunSuiteRequest> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;

  if (!isNonEmptyString(b["model"])) errors.push("model: must be a non-empty string");
  const adapter = b["adapter"] ?? b["providerId"];
  if (!isNonEmptyString(adapter)) errors.push("adapter (or providerId): must be a non-empty string");

  const flake = b["flake_detection"];
  let flakeConfig: { enabled?: boolean; retries?: number } | undefined;
  if (flake !== undefined) {
    if (!isRecord(flake)) {
      errors.push("flake_detection: must be an object");
    } else {
      if (flake["enabled"] !== undefined && !isBoolean(flake["enabled"])) errors.push("flake_detection.enabled: must be boolean");
      if (flake["retries"] !== undefined) {
        const r = flake["retries"];
        if (!isFiniteNumber(r) || Math.floor(r) !== r || r < 1 || r > 10) {
          errors.push("flake_detection.retries: must be an integer 1-10");
        }
      }
      flakeConfig = flake as { enabled?: boolean; retries?: number };
    }
  }

  if (b["suite_id"] !== undefined && !isNonEmptyString(b["suite_id"])) {
    errors.push("suite_id: must be a non-empty string");
  }

  const provider = b["provider"] === undefined || b["provider"] === null ? null : (typeof b["provider"] === "string" ? b["provider"] : null);
  const secondOpinion = validateReviewConfig(b["secondOpinion"], "secondOpinion", errors);
  const qcReview = validateReviewConfig(b["qcReview"], "qcReview", errors);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      model: b["model"] as string,
      adapter: adapter as string,
      provider,
      ...(b["suite_id"] ? { suite_id: b["suite_id"] as string } : {}),
      ...(flakeConfig ? { flake_detection: flakeConfig } : {}),
      ...(secondOpinion ? { secondOpinion } : {}),
      ...(qcReview ? { qcReview } : {}),
    },
  };
}

export function validateRunBatchRequest(raw: unknown): ValidationResult<RunBatchRequest> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;

  if (!isNonEmptyString(b["task"])) errors.push("task: must be a non-empty string");
  if (!Array.isArray(b["models"])) {
    errors.push("models: must be an array");
  } else if (b["models"].length < 2) {
    errors.push("models: must contain at least 2 entries");
  } else if (b["models"].length > 32) {
    errors.push("models: batch size is capped at 32");
  } else {
    for (let i = 0; i < b["models"].length; i++) {
      const m = b["models"][i];
      if (!isRecord(m)) { errors.push(`models[${i}]: must be an object`); continue; }
      if (!isNonEmptyString(m["model"])) errors.push(`models[${i}].model: required non-empty string`);
      const ad = m["adapter"] ?? m["providerId"];
      if (!isNonEmptyString(ad)) errors.push(`models[${i}].adapter (or providerId): required non-empty string`);
    }
  }

  const autoSynth = b["auto_synthesis"] === undefined ? true : !!b["auto_synthesis"];
  const secondOpinion = validateReviewConfig(b["secondOpinion"], "secondOpinion", errors);
  const qcReview = validateReviewConfig(b["qcReview"], "qcReview", errors);

  if (errors.length) return { ok: false, errors };
  const modelArr = (b["models"] as Array<Record<string, unknown>>).map((m) => ({
    adapter: (m["adapter"] ?? m["providerId"]) as string,
    provider: typeof m["provider"] === "string" ? (m["provider"] as string) : null,
    model: m["model"] as string,
  }));
  return {
    ok: true,
    value: {
      task: b["task"] as string,
      models: modelArr,
      auto_synthesis: autoSynth,
      ...(secondOpinion ? { secondOpinion } : {}),
      ...(qcReview ? { qcReview } : {}),
    },
  };
}

export function validateScoresSyncRequest(raw: unknown): ValidationResult<ScoresSyncRequest> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;

  if (!Array.isArray(b["scores"]) || b["scores"].length === 0) {
    return { ok: false, errors: ["scores: must be a non-empty array"] };
  }
  const source = typeof b["source"] === "string" && VALID_SCORE_SOURCES.has(b["source"]) ? b["source"] : "crucibulum";

  const rows: ScoreRow[] = [];
  for (let i = 0; i < b["scores"].length; i++) {
    const row = b["scores"][i];
    const rowErrors: string[] = [];
    if (!isRecord(row)) { errors.push(`scores[${i}]: must be an object`); continue; }
    if (!isNonEmptyString(row["modelId"])) rowErrors.push("modelId");
    if (!isNonEmptyString(row["taskId"])) rowErrors.push("taskId");
    if (typeof row["family"] !== "string" || !VALID_SCORE_FAMILIES.has(row["family"])) rowErrors.push(`family (must be one of ${[...VALID_SCORE_FAMILIES].join(",")})`);
    if (!isNonEmptyString(row["category"])) rowErrors.push("category");
    if (!isBoolean(row["passed"])) rowErrors.push("passed");
    if (!isFiniteNumber(row["score"]) || row["score"] < 0 || row["score"] > 100) rowErrors.push("score (0-100)");
    if (!isFiniteNumber(row["rawScore"])) rowErrors.push("rawScore");
    if (!isFiniteNumber(row["duration_ms"]) || row["duration_ms"] < 0) rowErrors.push("duration_ms (>=0)");
    if (!isNonEmptyString(row["timestamp"])) rowErrors.push("timestamp");

    if (rowErrors.length) {
      errors.push(`scores[${i}]: invalid fields: ${rowErrors.join(", ")}`);
    } else {
      rows.push(row as unknown as ScoreRow);
    }
  }
  if (rows.length === 0) {
    errors.push("no valid score rows after validation");
  }
  if (errors.length && rows.length === 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      scores: rows,
      source,
      ...(typeof b["runId"] === "string" ? { runId: b["runId"] } : {}),
    },
  };
}

export function validateSynthesisRequest(raw: unknown): ValidationResult<SynthesisRequest> {
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;
  const runIds = Array.isArray(b["run_ids"]) ? b["run_ids"].filter((x) => typeof x === "string") as string[] : [];
  const taskId = typeof b["task_id"] === "string" && b["task_id"].length > 0 ? b["task_id"] : undefined;
  if (runIds.length === 0 && !taskId) {
    return { ok: false, errors: ["run_ids (array of bundle ids) OR task_id (string) is required"] };
  }
  return {
    ok: true,
    value: {
      ...(runIds.length ? { run_ids: runIds } : {}),
      ...(taskId ? { task_id: taskId } : {}),
    },
  };
}

export function validateCrucibleLinkRequest(raw: unknown): ValidationResult<CrucibleLinkRequest> {
  if (!isRecord(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw;
  const errors: string[] = [];
  const profile_id = b["profile_id"] === undefined || b["profile_id"] === null
    ? null
    : typeof b["profile_id"] === "string" ? b["profile_id"] : (errors.push("profile_id: must be string or null"), null);
  let benchmark_score: number | null = null;
  if (b["benchmark_score"] !== undefined && b["benchmark_score"] !== null) {
    if (!isFiniteNumber(b["benchmark_score"])) errors.push("benchmark_score: must be a finite number or null");
    else benchmark_score = b["benchmark_score"];
  }
  const benchmark_label = b["benchmark_label"] === undefined || b["benchmark_label"] === null
    ? null
    : typeof b["benchmark_label"] === "string" ? b["benchmark_label"] : (errors.push("benchmark_label: must be string or null"), null);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { profile_id, benchmark_score, benchmark_label } };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateReviewConfig(
  raw: unknown,
  field: string,
  errors: string[],
): { enabled?: boolean; provider?: string; model?: string } | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) { errors.push(`${field}: must be an object`); return undefined; }
  if (raw["enabled"] !== undefined && !isBoolean(raw["enabled"])) errors.push(`${field}.enabled: must be boolean`);
  if (raw["provider"] !== undefined && typeof raw["provider"] !== "string") errors.push(`${field}.provider: must be a string`);
  if (raw["model"] !== undefined && typeof raw["model"] !== "string") errors.push(`${field}.model: must be a string`);
  const out: { enabled?: boolean; provider?: string; model?: string } = {};
  if (raw["enabled"] !== undefined && typeof raw["enabled"] === "boolean") out.enabled = raw["enabled"];
  if (typeof raw["provider"] === "string") out.provider = raw["provider"];
  if (typeof raw["model"] === "string") out.model = raw["model"];
  return out;
}
