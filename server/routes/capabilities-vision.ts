/**
 * Crucible — Capability promotion-evaluator endpoint (Vision)
 *
 * Read-only Vision promotion evaluator. Surfaces the doctrine
 * evaluator's PROVIDER_TESTED / STABLE / CAPABILITY_CERTIFIED
 * eligibility decisions for the three currently-tested Vision
 * routes (preferred, legacy, comparison) plus the doctrine gate
 * specs themselves.
 *
 * This is the Roadmap Phase D HTTP surface. It MUST NOT mutate
 * `MODEL_CERTIFICATION.models[]`, `certified-models.json`, or the
 * leaderboard composite — every response declares
 * `affectsLeaderboard: false` and `affectsCertification: false`,
 * `promoted: false`, and `noMutationGuarantee: true`. A separate,
 * future write-phase endpoint will be required to actually promote
 * a capability tier; this endpoint just reports what the doctrine
 * sees in current evidence.
 *
 * The route is GET-only. No POST/PUT/PATCH path is registered.
 * Adding one would require a separate doctrine-aware write phase.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sendJSON } from "./shared.js";

import { VISION_GATES, evaluatePromotion } from "../../core/capability-certification.js";
import type {
  CapabilityEvidenceRef,
  CapabilityPromotionDecision,
  CapabilityTier,
} from "../../core/capability-certification-types.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const STABILITY_DIR = join(REPO_ROOT, "reports", "capability-expansion", "vision-stability");

type VisionRouteRole =
  | "preferred_daily_driver_candidate"
  | "legacy_proven_fallback"
  | "comparison_route";

interface RouteSpec {
  provider: string;
  model: string;
  role: VisionRouteRole;
  /** Short, operator-visible justification — comes from the route's
   *  prior-phase report; not authoritative for the doctrine. */
  recommendationContext: string;
  fallbackEvidencePhasePointer: string;
}

const VISION_ROUTES: RouteSpec[] = [
  {
    provider: "openrouter",
    model: "xiaomi/mimo-v2.5",
    role: "preferred_daily_driver_candidate",
    recommendationContext: "Phase 13-A 5/5 smoke + 15/15 stability cells, no scorer caveats, ~9x lower observed cost per stability cell than xiaomi/mimo-v2-omni; promoted operationally via VISION_ROUTE_RECOMMENDATIONS, not via the capability registry.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase13a-mimo-v25-replacement/",
  },
  {
    provider: "openrouter",
    model: "xiaomi/mimo-v2-omni",
    role: "legacy_proven_fallback",
    recommendationContext: "Legacy/proven Vision fallback; 15/15 stability cells after the Phase 12 uncertainty scorer calibration. Higher observed cost per stability cell than xiaomi/mimo-v2.5.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase12-uncertainty-calibration/",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    role: "comparison_route",
    recommendationContext: "Cross-provider Vision reference route. Phase 12 stability showed 12/15 STABLE_PASS cells with a recurring MODEL miscount on vision-object-count-001 (honest model failure, not measurement instability).",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase12-uncertainty-calibration/",
  },
];

interface RouteEvidence {
  reportPath: string | null;
  generatedAt: string | null;
  commit: string | null;
  suiteSize: number;
  repeatRuns: number;
  stablePassRate: number;
  recurringAttributions: string[];
  independentRoutesTested: number;
  evidenceRefs: CapabilityEvidenceRef[];
  missing: boolean;
  reason: string | null;
}

interface RouteEvaluation {
  provider: string;
  model: string;
  role: VisionRouteRole;
  recommendationContext: string;
  currentTier: CapabilityTier;
  evidenceSource: string;
  evidenceSummary: {
    suiteSize: number;
    repeatRuns: number;
    stablePassRate: number;
    recurringAttributions: string[];
    independentRoutesTested: number;
    evidencePresent: boolean;
    missingEvidenceReason: string | null;
  };
  providerTestedDecision: CapabilityPromotionDecision;
  stableDecision: CapabilityPromotionDecision;
  capabilityCertifiedDecision: CapabilityPromotionDecision;
  /** Doctrinal guarantee surfaced on every per-route block too. */
  affectsLeaderboard: false;
  affectsCertification: false;
  promoted: false;
}

/**
 * Find the most-recent stability report for a given provider/model.
 * Returns null when no report exists; the caller turns that into a
 * blocker rather than crashing. Reports are timestamped with
 * lexicographically-sortable ISO-Z stamps, so the last file
 * alphabetically is the newest.
 */
function findLatestStabilityFor(provider: string, model: string): string | null {
  if (!existsSync(STABILITY_DIR)) return null;
  const candidates: string[] = [];
  for (const name of readdirSync(STABILITY_DIR)) {
    if (!name.endsWith(".json") || name === "latest.json") continue;
    try {
      const j = JSON.parse(readFileSync(join(STABILITY_DIR, name), "utf-8"));
      if (j.provider === provider && j.model === model) candidates.push(name);
    } catch {
      // ignore unparseable files
    }
  }
  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

function loadEvidence(provider: string, model: string): RouteEvidence {
  const latest = findLatestStabilityFor(provider, model);
  if (!latest) {
    return {
      reportPath: null,
      generatedAt: null,
      commit: null,
      suiteSize: 0,
      repeatRuns: 0,
      stablePassRate: 0,
      recurringAttributions: [],
      independentRoutesTested: 0,
      evidenceRefs: [],
      missing: true,
      reason: `no stability report on disk for ${provider} / ${model}`,
    };
  }
  const fullPath = join(STABILITY_DIR, latest);
  const j = JSON.parse(readFileSync(fullPath, "utf-8")) as {
    timestamp?: string;
    commit?: string;
    tests?: unknown[];
    runs?: number;
    dryRunGateEligibility?: {
      aggregateEvidence?: {
        totalCells?: number;
        passCells?: number;
        stablePassRate?: number;
        recurringAttributions?: string[];
        independentRoutesTested?: number;
        suiteSize?: number;
      };
    };
  };
  const ae = j.dryRunGateEligibility?.aggregateEvidence ?? {};
  const reportRelPath = `reports/capability-expansion/vision-stability/${latest}`;
  return {
    reportPath: reportRelPath,
    generatedAt: j.timestamp ?? null,
    commit: j.commit ?? null,
    suiteSize: typeof ae.suiteSize === "number" ? ae.suiteSize : (Array.isArray(j.tests) ? j.tests.length : 0),
    repeatRuns: typeof j.runs === "number" ? j.runs : 0,
    stablePassRate: typeof ae.stablePassRate === "number" ? ae.stablePassRate : 0,
    recurringAttributions: Array.isArray(ae.recurringAttributions) ? ae.recurringAttributions : [],
    independentRoutesTested: typeof ae.independentRoutesTested === "number" ? ae.independentRoutesTested : 1,
    evidenceRefs: [
      ((): CapabilityEvidenceRef => {
        const ref: CapabilityEvidenceRef = { kind: "stability", path: reportRelPath };
        if (j.timestamp) ref.generatedAt = j.timestamp;
        if (j.commit) ref.commit = j.commit;
        return ref;
      })(),
    ],
    missing: false,
    reason: null,
  };
}

function makeMissingEvidenceDecision(
  provider: string,
  model: string,
  proposedTier: CapabilityTier,
  reason: string,
): CapabilityPromotionDecision {
  return {
    eligible: false,
    capability: "vision",
    providerId: provider,
    modelId: model,
    currentTier: "EXPERIMENTAL",
    proposedTier,
    blockingReasons: [
      {
        gate: `vision.${proposedTier.toLowerCase().replace(/_/g, "-")}.evidence-missing`,
        reason,
        evidenceRefs: [],
      },
    ],
    evidenceRefs: [],
    generatedAt: new Date().toISOString(),
    affectsLeaderboard: false as const,
    affectsCertification: false as const,
  };
}

function evaluateRoute(spec: RouteSpec): RouteEvaluation {
  const ev = loadEvidence(spec.provider, spec.model);
  const evidenceSource = ev.reportPath ?? "no stability report on disk";

  const buildDecision = (proposedTier: CapabilityTier): CapabilityPromotionDecision => {
    if (ev.missing) return makeMissingEvidenceDecision(spec.provider, spec.model, proposedTier, ev.reason ?? "evidence missing");
    return evaluatePromotion({
      capability: "vision",
      providerId: spec.provider,
      modelId: spec.model,
      currentTier: "EXPERIMENTAL",
      proposedTier,
      suiteSize: ev.suiteSize,
      repeatRuns: ev.repeatRuns,
      stablePassRate: ev.stablePassRate,
      independentRoutesTested: ev.independentRoutesTested,
      recurringAttributions: ev.recurringAttributions,
      evidenceRefs: ev.evidenceRefs,
    });
  };

  return {
    provider: spec.provider,
    model: spec.model,
    role: spec.role,
    recommendationContext: spec.recommendationContext,
    currentTier: "EXPERIMENTAL",
    evidenceSource,
    evidenceSummary: {
      suiteSize: ev.suiteSize,
      repeatRuns: ev.repeatRuns,
      stablePassRate: ev.stablePassRate,
      recurringAttributions: ev.recurringAttributions,
      independentRoutesTested: ev.independentRoutesTested,
      evidencePresent: !ev.missing,
      missingEvidenceReason: ev.reason,
    },
    providerTestedDecision: buildDecision("PROVIDER_TESTED"),
    stableDecision: buildDecision("STABLE"),
    capabilityCertifiedDecision: buildDecision("CAPABILITY_CERTIFIED"),
    affectsLeaderboard: false as const,
    affectsCertification: false as const,
    promoted: false as const,
  };
}

export async function handlePromotionEvaluation(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const evaluatedRoutes = VISION_ROUTES.map(evaluateRoute);

  const preferred = VISION_ROUTES.find((r) => r.role === "preferred_daily_driver_candidate");
  const legacy = VISION_ROUTES.filter((r) => r.role === "legacy_proven_fallback").map((r) => ({
    provider: r.provider,
    model: r.model,
    role: r.role as VisionRouteRole,
    promotionExecuted: false as const,
    affectsLeaderboard: false as const,
    affectsCertification: false as const,
  }));

  sendJSON(res, 200, {
    capability: "vision",
    experimental: true,
    promoted: false,
    affectsLeaderboard: false,
    affectsCertification: false,
    generatedAt: new Date().toISOString(),
    currentTier: "EXPERIMENTAL",
    preferredDailyDriver: preferred
      ? {
          provider: preferred.provider,
          model: preferred.model,
          role: preferred.role,
          verdict: "DAILY_DRIVER_CANDIDATE_VALIDATED",
          promotionExecuted: false,
          affectsLeaderboard: false,
          affectsCertification: false,
        }
      : null,
    legacyFallbacks: legacy,
    evaluatedRoutes,
    doctrine: {
      providerTestedGate: VISION_GATES.PROVIDER_TESTED,
      stableGate: VISION_GATES.STABLE,
      capabilityCertifiedGate: VISION_GATES.CAPABILITY_CERTIFIED,
    },
    noMutationGuarantee: true,
    promotionRequiresFutureWritePhase: true,
    notes: {
      readOnly: "This endpoint never mutates MODEL_CERTIFICATION.models[], certified-models.json, the leaderboard composite, or any other persistent registry. The doctrine evaluator is a pure function (see core/capability-certification.ts:149).",
      capabilityCertifiedAlwaysBlockedToday: "Even when PROVIDER_TESTED and STABLE are eligible on a route, CAPABILITY_CERTIFIED remains blocked because the Vision suite has 5 tests (doctrine requires 15) and only 1 route per smoke (doctrine requires 3 independent routes). These blockers will surface in evaluatedRoutes[].capabilityCertifiedDecision.blockingReasons.",
      futureWritePhase: "A promotion write-phase endpoint (Roadmap Phase D follow-up) would be required to actually promote a capability tier. This phase only adds the read-only surface.",
    },
  });
}
