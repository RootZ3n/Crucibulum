/**
 * Crucible — Leaderboard & Scores Routes
 * Score queries, leaderboard, synthesis, verum ingest.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sendJSON, readBody, parseJsonBody, loadBundles, getBundleById, filterBundlesByTaskFamilies, resolveLaneScope, parseFamiliesParam, canonicalPercent, RUNS_DIR } from "./shared.js";
import { validateScoresSyncRequest, validateSynthesisRequest } from "../validators.js";
import type { EvidenceBundle } from "../../adapters/base.js";
import { loadVerifiedBundle, verifyBundle } from "../../core/bundle.js";
import { storeScores, queryScores } from "../../core/score-store.js";
import { runSynthesis } from "../../core/synthesis.js";
import { normalizeVerumIngest } from "../../core/verum.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { summarizeRunSet } from "../contracts.js";
import {
  FAMILY_WEIGHTS,
  LEADERBOARD_MIN_N,
  SCORE_FAMILIES,
  SCORE_FAMILY_SPECS,
  taskFamiliesForScoreFamilies,
  type LeaderboardEntry,
  type ModelScore,
  type ScoreSource,
  type ScoreFamily,
  type VerumIngestRequest,
} from "../../types/scores.js";
import { requireAuth } from "../auth.js";

function scoreFamilyForTaskFamily(taskFamily: string): ScoreFamily | null {
  for (const family of SCORE_FAMILIES) {
    if ((SCORE_FAMILY_SPECS[family].taskFamilies as string[]).includes(taskFamily)) {
      return family;
    }
  }
  if (taskFamily === "poison" || taskFamily === "security") {
    return "A";
  }
  return null;
}

type QuarantineReason =
  | "tampered"
  | "forged"
  | "legacy_unverified"
  | "unsigned_key_missing"
  | "unverified"
  | "mock_or_demo"
  | "malformed";

interface BundleEligibility {
  eligible: EvidenceBundle[];
  quarantined: Array<{
    bundle_id: string;
    task_id: string;
    family: string;
    adapter: string;
    provider: string;
    model: string;
    reasons: QuarantineReason[];
    signature_status: ReturnType<typeof verifyBundle>["signature_status"];
  }>;
  filters: {
    require_authenticated_bundle: true;
    exclude_tampered: true;
    exclude_legacy_unverified: true;
    exclude_mock_demo: true;
  };
}

interface MalformedBundleFile {
  file: string;
  task_id: string | null;
  family: string | null;
  reason: "invalid_json" | "invalid_bundle_shape";
}

interface MalformedBundleScope {
  total: number;
  inScope: number;
  unknownScope: number;
  examples: MalformedBundleFile[];
}

function isMockOrDemoBundle(bundle: EvidenceBundle): boolean {
  const values = [
    bundle.agent.adapter,
    bundle.agent.provider,
    bundle.agent.model,
    bundle.agent.system,
  ].map((value) => String(value ?? "").toLowerCase());
  return values.some((value) =>
    value.includes("harness-mock")
    || value.includes("mock")
    || value.includes("demo")
  );
}

function leaderboardIdentity(bundle: EvidenceBundle): { key: string; modelId: string; adapter: string; provider: string; model: string } {
  const adapter = bundle.agent.adapter || "unknown-adapter";
  const provider = bundle.agent.provider || "unknown-provider";
  const model = bundle.agent.model || "unknown-model";
  const key = `${adapter}:${provider}:${model}`;
  return { key, modelId: key, adapter, provider, model };
}

function filterLeaderboardEligibleBundles(bundles: EvidenceBundle[]): BundleEligibility {
  const eligible: EvidenceBundle[] = [];
  const quarantined: BundleEligibility["quarantined"] = [];

  for (const bundle of bundles) {
    const verification = verifyBundle(bundle);
    const signatureStatus = ((bundle.trust ?? {}) as { bundle_signature_status?: ReturnType<typeof verifyBundle>["signature_status"] }).bundle_signature_status ?? verification.signature_status;
    const authenticated = signatureStatus === "valid" || (!((bundle.trust ?? {}) as { bundle_signature_status?: string }).bundle_signature_status && verification.valid);
    const reasons: QuarantineReason[] = [];

    if (!authenticated) {
      if (signatureStatus === "tampered") reasons.push("tampered");
      else if (signatureStatus === "forged") reasons.push("tampered");
      else if (signatureStatus === "legacy_unverified") reasons.push("legacy_unverified");
      else if (signatureStatus === "unsigned_key_missing") reasons.push("unsigned_key_missing");
      else reasons.push("unverified");
    }
    if (bundle.trust?.bundle_verified !== true) {
      reasons.push("unverified");
    }
    if (isMockOrDemoBundle(bundle)) {
      reasons.push("mock_or_demo");
    }

    if (reasons.length === 0) {
      eligible.push(bundle);
    } else {
      quarantined.push({
        bundle_id: bundle.bundle_id,
        task_id: bundle.task.id,
        family: bundle.task.family,
        adapter: bundle.agent.adapter || "unknown-adapter",
        provider: bundle.agent.provider || "unknown-provider",
        model: bundle.agent.model || "unknown-model",
        reasons: [...new Set(reasons)],
        signature_status: signatureStatus,
      });
    }
  }

  return {
    eligible,
    quarantined,
    filters: {
      require_authenticated_bundle: true,
      exclude_tampered: true,
      exclude_legacy_unverified: true,
      exclude_mock_demo: true,
    },
  };
}

function reasonBuckets(quarantined: BundleEligibility["quarantined"], malformedInScope: number): Record<QuarantineReason, number> {
  const buckets: Record<QuarantineReason, number> = {
    tampered: 0,
    forged: 0,
    legacy_unverified: 0,
    unsigned_key_missing: 0,
    unverified: 0,
    mock_or_demo: 0,
    malformed: malformedInScope,
  };
  for (const entry of quarantined) {
    for (const reason of entry.reasons) buckets[reason] = (buckets[reason] ?? 0) + 1;
  }
  return buckets;
}

function safeQuarantineExamples(quarantined: BundleEligibility["quarantined"], malformed: MalformedBundleFile[]): Array<Record<string, unknown>> {
  const bundleExamples = quarantined.slice(0, 10).map((entry) => ({
    kind: "bundle",
    bundle_id: entry.bundle_id,
    task_id: entry.task_id,
    family: entry.family,
    adapter: entry.adapter,
    provider: entry.provider,
    model: entry.model,
    reasons: entry.reasons,
    signature_status: entry.signature_status,
    label: "NOT RANKED",
  }));
  const malformedExamples = malformed.slice(0, Math.max(0, 10 - bundleExamples.length)).map((entry) => ({
    kind: "malformed",
    file: entry.file,
    task_id: entry.task_id,
    family: entry.family,
    reasons: ["malformed"],
    parse_status: entry.reason,
    label: "MALFORMED · NOT RANKED",
  }));
  return [...bundleExamples, ...malformedExamples];
}

function inspectMalformedBundleFiles(taskFamilies: string[] | null): MalformedBundleScope {
  try {
    const familySet = taskFamilies && taskFamilies.length > 0 ? new Set(taskFamilies) : null;
    const examples: MalformedBundleFile[] = [];
    let total = 0;
    let inScope = 0;
    let unknownScope = 0;
    for (const file of readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".crucible.json"))) {
      const raw = readFileSync(join(RUNS_DIR, file), "utf-8");
      try {
        if (loadVerifiedBundle(raw, file)) continue;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        const partial = parsed && typeof parsed === "object" ? parsed as { task?: { id?: unknown; family?: unknown } } : null;
        const family = typeof partial?.task?.family === "string" ? partial.task.family : null;
        const taskId = typeof partial?.task?.id === "string" ? partial.task.id : null;
        const reason = partial ? "invalid_bundle_shape" : "invalid_json";
        total++;
        if (!familySet) inScope++;
        else if (family && familySet.has(family)) inScope++;
        else if (!family) unknownScope++;
        examples.push({ file, task_id: taskId, family, reason });
      } catch {
        total++;
        unknownScope++;
        examples.push({ file, task_id: null, family: null, reason: "invalid_json" });
      }
    }
    return { total, inScope, unknownScope, examples };
  } catch {
    return { total: 0, inScope: 0, unknownScope: 0, examples: [] };
  }
}

function buildLeaderboardPayload(
  bundles: EvidenceBundle[],
  url: URL,
  scope: { taskFamilies: string[] | null; scopeKey: string },
  extras: Record<string, unknown>,
): Record<string, unknown> {
  const eligibility = filterLeaderboardEligibleBundles(bundles);
  const malformed = inspectMalformedBundleFiles(scope.taskFamilies);
  const buckets = reasonBuckets(eligibility.quarantined, malformed.inScope);
  const quarantinedCount = eligibility.quarantined.length + malformed.inScope;
  const includeQuarantined = url.searchParams.get("include_quarantined") === "1";
  const malformedExamples = malformed.examples.filter((entry) => {
    if (!scope.taskFamilies || scope.taskFamilies.length === 0) return true;
    return entry.family ? scope.taskFamilies.includes(entry.family) : false;
  });
  return {
    leaderboard: buildScopedLeaderboardEntries(eligibility.eligible),
    ...extras,
    scope_key: scope.scopeKey,
    eligible_count: eligibility.eligible.length,
    quarantined_count: quarantinedCount,
    ineligible_count: quarantinedCount,
    malformed_count: malformed.inScope,
    malformed_count_in_scope: malformed.inScope,
    malformed_count_total: malformed.total,
    malformed_count_unknown_scope: malformed.unknownScope,
    filters_applied: eligibility.filters,
    excluded_mock_demo: true,
    excluded_unverified_or_tampered: true,
    ranking_mode: "public_verified",
    quarantine_reason_buckets: buckets,
    quarantine_examples: includeQuarantined ? safeQuarantineExamples(eligibility.quarantined, malformedExamples) : undefined,
    quarantined: includeQuarantined ? eligibility.quarantined : undefined,
  };
}

function buildScopedLeaderboardEntries(bundles: EvidenceBundle[]): LeaderboardEntry[] {
  const grouped = new Map<string, EvidenceBundle[]>();
  for (const bundle of bundles) {
    const identity = leaderboardIdentity(bundle);
    const group = grouped.get(identity.key) ?? [];
    group.push(bundle);
    grouped.set(identity.key, group);
  }

  const entries: LeaderboardEntry[] = [];
  for (const [identityKey, runs] of grouped) {
    const identity = leaderboardIdentity(runs[0]!);
    const summary = summarizeRunSet(runs);
    const familyAverages: Record<ScoreFamily, number | null> = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null };
    const weighted: Array<{ family: ScoreFamily; score: number }> = [];
    for (const family of SCORE_FAMILIES) {
      const familyRuns = runs.filter((bundle) => scoreFamilyForTaskFamily(bundle.task.family) === family);
      if (familyRuns.length === 0) continue;
      const average = Math.round((familyRuns.reduce((sum, bundle) => sum + canonicalPercent(bundle.score.total), 0) / familyRuns.length) * 100) / 100;
      familyAverages[family] = average;
      weighted.push({ family, score: average });
    }
    const weightedSum = weighted.reduce((sum, item) => sum + item.score * FAMILY_WEIGHTS[item.family], 0);
    const totalWeight = weighted.reduce((sum, item) => sum + FAMILY_WEIGHTS[item.family], 0);
    const composite = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : Math.round(summary.avg_score * 100) / 100;
    const averagePassRate = summary.run_count > 0 ? Math.round((summary.passes / summary.run_count) * 100) / 100 : 0;
    const stabilityScore = Math.round(Math.abs(averagePassRate - 0.5) * 2 * 100) / 100;
    const sampleAdequate = summary.run_count >= LEADERBOARD_MIN_N;
    const samplePenalty = sampleAdequate ? 1 : Math.max(0, summary.run_count) / LEADERBOARD_MIN_N;
    const reliabilityScore = Math.round((composite * (0.5 + stabilityScore * 0.5) * samplePenalty) * 100) / 100;
    const confidence: "high" | "medium" | "low" = !sampleAdequate
      ? "low"
      : averagePassRate >= 0.95 && stabilityScore >= 0.8
        ? "high"
        : averagePassRate >= 0.7 || stabilityScore >= 0.5
          ? "medium"
          : "low";
    const lastRun = runs.reduce((latest, bundle) => bundle.environment.timestamp_start > latest ? bundle.environment.timestamp_start : latest, "");

    entries.push({
      modelId: identity.modelId,
      identity_key: identityKey,
      adapter: identity.adapter,
      provider: identity.provider,
      model: identity.model,
      composite,
      families: familyAverages,
      totalRuns: summary.run_count,
      completedRuns: summary.run_count - summary.not_complete,
      notCompleteRuns: summary.not_complete,
      lastRun,
      source: "crucibulum",
      average_pass_rate: averagePassRate,
      model_failure_rate: summary.run_count > 0 ? Math.round((summary.failures / summary.run_count) * 100) / 100 : 0,
      completion_rate: summary.run_count > 0 ? Math.round(((summary.run_count - summary.not_complete) / summary.run_count) * 100) / 100 : 0,
      nc_rate: summary.run_count > 0 ? Math.round((summary.not_complete / summary.run_count) * 100) / 100 : 0,
      stability_score: stabilityScore,
      reliability_score: reliabilityScore,
      confidence,
      sample_adequate: sampleAdequate,
      sample_penalty: Math.round(samplePenalty * 100) / 100,
    });
  }

  entries.sort((a, b) => {
    const aRel = a.reliability_score ?? a.composite;
    const bRel = b.reliability_score ?? b.composite;
    if (bRel !== aRel) return bRel - aRel;
    if ((b.average_pass_rate ?? 0) !== (a.average_pass_rate ?? 0)) return (b.average_pass_rate ?? 0) - (a.average_pass_rate ?? 0);
    if ((b.stability_score ?? 0) !== (a.stability_score ?? 0)) return (b.stability_score ?? 0) - (a.stability_score ?? 0);
    if (b.composite !== a.composite) return b.composite - a.composite;
    return a.modelId.localeCompare(b.modelId);
  });
  return entries;
}

export async function handleScoresSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const parsed = await parseJsonBody<unknown>(req);
  if (!parsed.ok) { sendJSON(res, 400, { ok: false, stored: 0, errors: [parsed.error] }); return; }
  const v = validateScoresSyncRequest(parsed.value);
  if (!v.ok) { sendJSON(res, 400, { ok: false, stored: 0, errors: v.errors }); return; }
  const body = v.value;
  const source = body.source as ScoreSource;
  const validScores = body.scores as unknown as ModelScore[];

  const result = storeScores(validScores, source, body.runId);
  // 200 = all accepted, 207 = partial (some stored, some rejected), 400 = nothing stored.
  const status = result.errors.length === 0 ? 200 : result.stored === 0 ? 400 : 207;
  sendJSON(res, status, {
    ok: result.errors.length === 0,
    stored: result.stored,
    errors: result.errors,
  });
}

export async function handleVerumIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const parsed = await parseJsonBody<VerumIngestRequest>(req);
  if (!parsed.ok) { sendJSON(res, 400, { ok: false, stored: 0, errors: [parsed.error], source: "verum" }); return; }
  const body = parsed.value;
  if (!body || typeof body.modelId !== "string" || typeof body.provider !== "string" || typeof body.adapter !== "string" || !Array.isArray(body.results) || body.results.length === 0) {
    sendJSON(res, 400, { ok: false, stored: 0, errors: ["modelId, provider, adapter, and a non-empty results array are required"], source: "verum" });
    return;
  }

  const scores = normalizeVerumIngest(body);
  const result = storeScores(scores, "verum", body.runId);
  sendJSON(res, 200, {
    ok: result.errors.length === 0,
    stored: result.stored,
    errors: result.errors,
    source: "verum",
  });
}

export async function handleScoresQuery(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const modelId = url.searchParams.get("modelId") ?? undefined;
  const family = url.searchParams.get("family") ?? undefined;
  const taskId = url.searchParams.get("taskId") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const parsedLimit = parseInt(url.searchParams.get("limit") ?? "100", 10);
  // Clamp limit: negative / NaN / over-cap all fall back to a safe bound.
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 100;
  const scores = queryScores({ modelId, family, taskId, source, limit });
  sendJSON(res, 200, { scores, count: scores.length });
}

export async function handleLeaderboard(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const scope = resolveLaneScope(url);
  if (scope.taskFamilies && scope.taskFamilies.length > 0) {
    // Lane-scoped path: filter the full bundle set by the requested task
    // families BEFORE ranking, so best/worst/reliability are computed over the
    // same lane the UI asked for. We deliberately do not fall back to the
    // shared score-store on this path — that DB is populated by external
    // ingest (verum/crucibulum sync) and would cross-contaminate a scoped
    // leaderboard with rows that don't belong to any of the requested lanes.
    const scopedBundles = filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies);
    sendJSON(res, 200, buildLeaderboardPayload(scopedBundles, url, scope, {
      task_families: scope.taskFamilies,
    }));
    return;
  }
  // Global ("all lanes") path. Public ranking still goes through the same
  // bundle eligibility gate as lane views; the score-store remains available
  // through /api/scores for raw/admin inspection but does not decide public
  // leaderboard rank.
  const families = parseFamiliesParam(url);
  const taskFamilies = taskFamiliesForScoreFamilies(families);
  const scopedBundles = taskFamilies.length > 0
    ? filterBundlesByTaskFamilies(loadBundles(), taskFamilies)
    : loadBundles();
  const effectiveScope = {
    taskFamilies: taskFamilies.length > 0 ? taskFamilies : null,
    scopeKey: taskFamilies.length > 0 ? [...taskFamilies].sort().join(",") : "all",
  };
  sendJSON(res, 200, buildLeaderboardPayload(scopedBundles, url, effectiveScope, {
    families,
    task_families: taskFamilies.length > 0 ? taskFamilies : null,
  }));
}

export async function handleLeaderboardQuarantine(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const scope = resolveLaneScope(url);
  const scopedBundles = scope.taskFamilies && scope.taskFamilies.length > 0
    ? filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies)
    : loadBundles();
  const eligibility = filterLeaderboardEligibleBundles(scopedBundles);
  const malformed = inspectMalformedBundleFiles(scope.taskFamilies);
  const malformedExamples = malformed.examples.filter((entry) => {
    if (!scope.taskFamilies || scope.taskFamilies.length === 0) return true;
    return entry.family ? scope.taskFamilies.includes(entry.family) : false;
  });
  const buckets = reasonBuckets(eligibility.quarantined, malformed.inScope);
  sendJSON(res, 200, {
    ranking_mode: "public_verified",
    scope_key: scope.scopeKey,
    task_families: scope.taskFamilies,
    eligible_count: eligibility.eligible.length,
    quarantined_count: eligibility.quarantined.length + malformed.inScope,
    ineligible_count: eligibility.quarantined.length + malformed.inScope,
    malformed_count_in_scope: malformed.inScope,
    malformed_count_total: malformed.total,
    malformed_count_unknown_scope: malformed.unknownScope,
    reason_buckets: buckets,
    labels: ["NOT RANKED", "UNVERIFIED", "TAMPERED", "MOCK/DEMO", "MALFORMED"],
    examples: safeQuarantineExamples(eligibility.quarantined, malformedExamples),
  });
}

export async function handleSynthesis(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const parsed = await parseJsonBody<unknown>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const v = validateSynthesisRequest(parsed.value);
  if (!v.ok) { sendJSON(res, 400, { error: "Invalid synthesis request", details: v.errors }); return; }
  const body = v.value;
  let bundles: EvidenceBundle[];

  if (body.run_ids && body.run_ids.length > 0) {
    bundles = [];
    for (const id of body.run_ids) {
      const bundle = getBundleById(id);
      if (!bundle) {
        sendJSON(res, 404, { error: `Run not found: ${id}` });
        return;
      }
      bundles.push(bundle);
    }
  } else if (body.task_id) {
    const allBundles = loadBundles();
    bundles = allBundles.filter((bundle) => bundle.task.id === body.task_id);
    if (bundles.length === 0) {
      sendJSON(res, 404, { error: `No runs found for task: ${body.task_id}` });
      return;
    }
  } else {
    sendJSON(res, 400, { error: "run_ids or task_id is required" });
    return;
  }

  const taskIds = new Set(bundles.map((bundle) => bundle.task.id));
  if (taskIds.size > 1) {
    sendJSON(res, 400, { error: `All runs must be for the same task. Found: ${Array.from(taskIds).join(", ")}` });
    return;
  }

  const synthesis = runSynthesis(bundles);
  sendJSON(res, 200, { synthesis });
}
