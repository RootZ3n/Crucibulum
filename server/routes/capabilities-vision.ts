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
  | "comparison_route"
  | "independent_route_family";

interface RouteSpec {
  provider: string;
  model: string;
  role: VisionRouteRole;
  /** Independent model family for doctrine-aggregate counting.
   *  Mimo variants share one family; OpenAI GPT-5 variants share
   *  one family; Anthropic Claude variants share one family. */
  family: string;
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
    family: "MiMo",
    recommendationContext: "Phase 13-A 5/5 smoke + 15/15 stability cells, no scorer caveats, ~9x lower observed cost per stability cell than xiaomi/mimo-v2-omni; promoted operationally via VISION_ROUTE_RECOMMENDATIONS, not via the capability registry.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase13a-mimo-v25-replacement/",
  },
  {
    provider: "openrouter",
    model: "xiaomi/mimo-v2-omni",
    role: "legacy_proven_fallback",
    family: "MiMo",
    recommendationContext: "Legacy/proven Vision fallback; 15/15 stability cells after the Phase 12 uncertainty scorer calibration. Higher observed cost per stability cell than xiaomi/mimo-v2.5. Same MiMo family as v2.5 — does not count as an independent family slot.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase12-uncertainty-calibration/",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    role: "comparison_route",
    family: "GPT-5",
    recommendationContext: "Cross-provider Vision reference route. Phase 15 stability refresh on the expanded 15-test suite shows 14/15 STABLE_PASS cells + 1 RECURRING_FAIL MODEL on vision-object-count-001 (honest model failure, not measurement instability). Independent family from MiMo.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase15-independent-routes/",
  },
  {
    provider: "openrouter",
    model: "anthropic/claude-haiku-4-5",
    role: "independent_route_family",
    family: "Anthropic",
    recommendationContext: "Phase 15 / Roadmap E third independent Vision route family. Routed through OpenRouter (the openai_image_url transport proxies cleanly). 15/15 smoke PASS + 45/45 stability cells STABLE_PASS, no recurring attributions. Independent family from MiMo and GPT-5.",
    fallbackEvidencePhasePointer: "reports/capability-expansion/vision-phase15-independent-routes/",
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
  family: string;
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
    family: spec.family,
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

/**
 * Phase 15 / Roadmap E — aggregate-family CAPABILITY_CERTIFIED check.
 *
 * The per-route `capabilityCertifiedDecision` always reports
 * `independent-routes` as a blocker because each route's stability
 * evidence carries `independentRoutesTested: 1` (it only knows about
 * itself). The aggregate check below counts the distinct
 * model/provider families that have **15-test stability evidence at
 * >=80% pass rate with no disallowed recurring attribution**, then
 * asks the doctrine evaluator whether CAPABILITY_CERTIFIED is
 * dry-run eligible at that aggregate count.
 *
 * Doctrine independence: MiMo variants share one family (per the
 * Phase A doctrine + the Phase 15 inventory). GPT-5 variants share
 * one family. Anthropic Claude variants share one family. The
 * `family` field on `RouteSpec` is the canonical source.
 *
 * This function is read-only. It does not promote anything — even
 * when CAPABILITY_CERTIFIED is dry-run eligible, the top-level
 * response still declares `promoted: false` and
 * `promotionRequiresFutureWritePhase: true`.
 */
function buildAggregateCapabilityCertifiedDecision(
  routes: RouteSpec[],
  evaluations: RouteEvaluation[],
): { decision: CapabilityPromotionDecision; familiesQualifying: string[]; routesQualifying: Array<{ provider: string; model: string; family: string }> } {
  const disallowed = new Set(["CONFIG", "PROVIDER", "FIXTURE", "SCORER"]);
  // A route "qualifies" if it has 15-test stability evidence at
  // >=80% pass rate AND no recurring CONFIG/PROVIDER/FIXTURE/SCORER
  // attribution. Recurring MODEL attribution is allowed (honest model
  // failures don't undermine measurement integrity).
  const routesQualifying = evaluations
    .map((e, i) => ({ e, spec: routes[i] }))
    .filter(({ e }) => e.evidenceSummary.evidencePresent
      && e.evidenceSummary.suiteSize >= 15
      && e.evidenceSummary.stablePassRate >= 0.80
      && !e.evidenceSummary.recurringAttributions.some((a) => disallowed.has(a)))
    .map(({ e, spec }) => ({ provider: e.provider, model: e.model, family: spec.family }));

  const familiesQualifying = [...new Set(routesQualifying.map((r) => r.family))].sort();

  // Pick the best-representative qualifying route's evidence to
  // pass to the doctrine evaluator as the "anchor" — substitute the
  // cross-route family count for its native single-route count.
  const anchorIdx = evaluations.findIndex((e) => e.evidenceSummary.evidencePresent && e.evidenceSummary.suiteSize >= 15);
  const aggregateEvidenceRefs: CapabilityEvidenceRef[] = [];
  for (const e of evaluations) {
    if (e.evidenceSource !== "no stability report on disk") {
      aggregateEvidenceRefs.push({ kind: "stability", path: e.evidenceSource });
    }
  }

  if (anchorIdx === -1) {
    // No qualifying evidence at all — return a synthetic blocker.
    return {
      decision: {
        eligible: false,
        capability: "vision",
        providerId: "(aggregate)",
        modelId: "(aggregate)",
        currentTier: "EXPERIMENTAL",
        proposedTier: "CAPABILITY_CERTIFIED",
        blockingReasons: [
          {
            gate: "vision.capability-certified.evidence-missing",
            reason: "no route has 15-test stability evidence yet — aggregate cannot be evaluated",
            evidenceRefs: aggregateEvidenceRefs,
          },
        ],
        evidenceRefs: aggregateEvidenceRefs,
        generatedAt: new Date().toISOString(),
        affectsLeaderboard: false as const,
        affectsCertification: false as const,
      },
      familiesQualifying,
      routesQualifying,
    };
  }

  const anchor = evaluations[anchorIdx];
  const decision = evaluatePromotion({
    capability: "vision",
    providerId: "(aggregate)",
    modelId: "(aggregate)",
    currentTier: "EXPERIMENTAL",
    proposedTier: "CAPABILITY_CERTIFIED",
    suiteSize: anchor.evidenceSummary.suiteSize,
    repeatRuns: anchor.evidenceSummary.repeatRuns,
    stablePassRate: anchor.evidenceSummary.stablePassRate,
    independentRoutesTested: familiesQualifying.length,
    // Aggregate recurring attributions — collect the union across
    // qualifying routes so disallowed kinds anywhere block the
    // aggregate decision.
    recurringAttributions: [...new Set(routesQualifying.flatMap(({ provider, model }) => {
      const e = evaluations.find((x) => x.provider === provider && x.model === model);
      return e?.evidenceSummary.recurringAttributions ?? [];
    }))],
    evidenceRefs: aggregateEvidenceRefs,
  });
  return { decision, familiesQualifying, routesQualifying };
}

export async function handlePromotionEvaluation(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const evaluatedRoutes = VISION_ROUTES.map(evaluateRoute);
  const aggregate = buildAggregateCapabilityCertifiedDecision(VISION_ROUTES, evaluatedRoutes);

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
    // Phase 15 / Roadmap E — aggregate-family doctrine view. The
    // per-route capabilityCertifiedDecision always reports
    // independent-routes as a blocker because each route's evidence
    // is single-route by construction. This aggregate counts
    // qualifying families across all evaluated routes and re-runs
    // the doctrine evaluator with the cross-route count.
    aggregateCapabilityCertified: {
      independentFamiliesQualifying: aggregate.familiesQualifying,
      independentFamilyCount: aggregate.familiesQualifying.length,
      independentFamilyTarget: VISION_GATES.CAPABILITY_CERTIFIED.minIndependentRoutes,
      routesQualifying: aggregate.routesQualifying,
      decision: aggregate.decision,
      // The aggregate is still read-only and never promotes.
      promoted: false,
      affectsLeaderboard: false,
      affectsCertification: false,
    },
    doctrine: {
      providerTestedGate: VISION_GATES.PROVIDER_TESTED,
      stableGate: VISION_GATES.STABLE,
      capabilityCertifiedGate: VISION_GATES.CAPABILITY_CERTIFIED,
    },
    noMutationGuarantee: true,
    promotionRequiresFutureWritePhase: true,
    notes: {
      readOnly: "This endpoint never mutates MODEL_CERTIFICATION.models[], certified-models.json, the leaderboard composite, or any other persistent registry. The doctrine evaluator is a pure function (see core/capability-certification.ts:149).",
      capabilityCertifiedAlwaysBlockedToday: "Per-route capabilityCertifiedDecision blocks every route on independent-routes (1 < 3) because each route's evidence is single-route by construction. Phase 15 / Roadmap E added aggregateCapabilityCertified, which counts qualifying families across all evaluated routes and re-runs the doctrine evaluator with the cross-route count. The Vision suite is 15 tests (Phase 14 / Roadmap C); aggregate independent families with full-suite stability evidence is the doctrine gate that matters at the cross-route level. Even when the aggregate is dry-run eligible, this endpoint still declares promoted:false / promotionRequiresFutureWritePhase:true — actual promotion needs the future write-phase endpoint.",
      futureWritePhase: "A promotion write-phase endpoint (Roadmap Phase D follow-up) would be required to actually promote a capability tier. This phase only adds the read-only surface.",
    },
  });
}
