/**
 * Luak — Capability Export Routes
 *
 * Generic capability summary and eligibility exports.
 * Format is standalone JSON — useful with or without any downstream consumer.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, loadBundles } from "./shared.js";
import {
  SCORE_FAMILIES,
  SCORE_FAMILY_SPECS,
  FAMILY_WEIGHTS,
  LEADERBOARD_MIN_N,
  type ScoreFamily,
} from "../../types/scores.js";
import { normalizeBundleVerdict } from "../../core/verdict.js";
import { canonicalPercent } from "../../types/scores.js";
import { synthesizeEligibility, type ModelScoreSummary } from "../../core/eligibility.js";

function scoreFamilyForTaskFamily(taskFamily: string): ScoreFamily | null {
  for (const f of SCORE_FAMILIES) {
    if (SCORE_FAMILY_SPECS[f].taskFamilies.includes(taskFamily as never)) return f;
  }
  return null;
}

function buildModelSummaries(): ModelScoreSummary[] {
  const bundles = loadBundles();
  const byModel = new Map<string, typeof bundles>();

  for (const b of bundles) {
    const key = `${b.agent?.provider ?? "unknown"}::${b.agent?.model ?? "unknown"}`;
    const arr = byModel.get(key) ?? [];
    arr.push(b);
    byModel.set(key, arr);
  }

  const summaries: ModelScoreSummary[] = [];

  for (const [, modelBundles] of byModel) {
    const first = modelBundles[0];
    const model = first.agent?.model ?? "unknown";
    const provider = first.agent?.provider ?? "unknown";

    const scoringBundles = modelBundles.filter((b) => normalizeBundleVerdict(b).countsTowardModelScore);
    const families: Partial<Record<ScoreFamily, number | null>> = {};

    for (const f of SCORE_FAMILIES) {
      const familyBundles = scoringBundles.filter((b) => scoreFamilyForTaskFamily(b.task?.family ?? "") === f);
      if (familyBundles.length === 0) {
        families[f] = null;
        continue;
      }
      families[f] = Math.round(
        (familyBundles.reduce((sum, b) => sum + canonicalPercent(b.score?.total ?? 0), 0) / familyBundles.length) * 100,
      ) / 100;
    }

    // Compute composite
    let weightedSum = 0;
    let weightTotal = 0;
    for (const f of SCORE_FAMILIES) {
      const score = families[f];
      if (score !== null && score !== undefined) {
        weightedSum += score * FAMILY_WEIGHTS[f];
        weightTotal += FAMILY_WEIGHTS[f];
      }
    }
    const composite = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;

    // Collect failure modes from bundle metadata
    const failureModes = new Set<string>();
    for (const b of modelBundles) {
      const v = normalizeBundleVerdict(b);
      if (v.failureReasonCode && v.failureReasonCode !== "pass") {
        // Map known failure reason codes to canonical failure modes
        const code = String(v.failureReasonCode).toUpperCase();
        if (code.includes("SCOPE")) failureModes.add("SCOPE_VIOLATION");
        if (code.includes("UNVERIFIED")) failureModes.add("UNVERIFIED_SUCCESS");
        if (code.includes("FABRICAT")) failureModes.add("FABRICATED_EVIDENCE");
        if (code.includes("LOOP")) failureModes.add("TOOL_LOOP_DETECTED");
        if (code.includes("BUDGET")) failureModes.add("BUDGET_BREACH");
        if (code.includes("RECEIPT")) failureModes.add("RECEIPT_MISMATCH");
        if (code.includes("DIRTY")) failureModes.add("DIRTY_WORKSPACE_IGNORED");
        if (code.includes("APPROVAL")) failureModes.add("APPROVAL_BOUNDARY_VIOLATION");
        if (code.includes("DELEGAT")) failureModes.add("DELEGATION_BOUNDARY_VIOLATION");
      }
    }

    const timestamps = modelBundles.map((b) => b.environment?.timestamp_end ?? b.environment?.timestamp_start ?? "").filter(Boolean).sort();
    const lastTested = timestamps[timestamps.length - 1] || null;

    summaries.push({
      model,
      provider,
      families,
      composite,
      totalRuns: modelBundles.length,
      failureModes: [...failureModes],
      sampleAdequate: modelBundles.length >= LEADERBOARD_MIN_N,
      lastTested,
    });
  }

  return summaries.sort((a, b) => b.composite - a.composite);
}

export async function handleCapabilitySummary(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const summaries = buildModelSummaries();
  const results = summaries.map((s) => synthesizeEligibility(s));
  sendJSON(res, 200, {
    schema: "crucible.capability-summary.v1",
    exported_at: new Date().toISOString(),
    models: results,
  });
}

export async function handleModelEligibility(_req: IncomingMessage, res: ServerResponse, modelId: string): Promise<void> {
  const summaries = buildModelSummaries();
  const match = summaries.find((s) => s.model === modelId || `${s.provider}/${s.model}` === modelId);
  if (!match) {
    sendJSON(res, 404, { error: `Model not found: ${modelId}` });
    return;
  }
  sendJSON(res, 200, synthesizeEligibility(match));
}
