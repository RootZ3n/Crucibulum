/**
 * Crucibulum — Synthesis Layer (Veritor Mode)
 *
 * Multi-model comparative analysis engine.
 * Extracts structured claims from evidence bundles, identifies consensus,
 * detects outliers, compares against deterministic truth.
 *
 * CRITICAL: This is advisory analysis only. It NEVER overrides deterministic judge results.
 * All model outputs are treated as untrusted input and sanitized before processing.
 */
import { scanForInjection } from "../security/velum.js";
import { log } from "../utils/logger.js";
// ── Constants ─────────────────────────────────────────────────────────────
/** Minimum models sharing a claim to form consensus */
const CONSENSUS_THRESHOLD = 2;
/** Max claim text length before truncation */
const MAX_CLAIM_LENGTH = 200;
/** Max claims per model to prevent abuse */
const MAX_CLAIMS_PER_MODEL = 50;
// ── Sanitization ──────────────────────────────────────────────────────────
function sanitizeText(text) {
    const scan = scanForInjection(text);
    let clean = text;
    if (!scan.clean) {
        for (const violation of scan.violations) {
            if (!violation.context)
                continue;
            const escaped = violation.context.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            clean = clean.replace(new RegExp(escaped, "gi"), "[redacted]");
        }
    }
    return { clean, flagged: !scan.clean };
}
function truncate(text, max = MAX_CLAIM_LENGTH) {
    return text.length <= max ? text : `${text.slice(0, max)}...[truncated]`;
}
// ── Claim Extraction ──────────────────────────────────────────────────────
/**
 * Normalize a claim string for comparison.
 * Lowercase, strip punctuation, collapse whitespace.
 */
function normalizeClaim(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Strip code blocks from text to focus on natural language claims.
 */
function stripCodeBlocks(text) {
    return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
}
/**
 * Extract structured claims from a single evidence bundle.
 * Claims come from verification results, diagnosis, and timeline — not raw model output.
 * This keeps synthesis deterministic and avoids LLM dependency.
 */
function extractClaims(bundle) {
    const claims = [];
    let claimIndex = 0;
    const addClaim = (text, source) => {
        const sanitized = sanitizeText(text);
        const clean = truncate(sanitized.clean);
        if (clean.length < 3)
            return; // skip empty/trivial
        claims.push({
            id: `claim_${claimIndex++}`,
            text: clean,
            normalized: normalizeClaim(clean),
            source,
        });
    };
    // ── Verification-based claims ──────────────────────────────────────
    const vr = bundle.verification_results;
    // Correctness: per-check pass/fail
    for (const [check, result] of Object.entries(vr.correctness.details)) {
        addClaim(`correctness:${check}:${result}`, "verification");
    }
    // Regression: per-check pass/fail
    for (const [check, result] of Object.entries(vr.regression.details)) {
        addClaim(`regression:${check}:${result}`, "verification");
    }
    // Integrity violations
    for (const violation of vr.integrity.violations) {
        addClaim(`integrity_violation:${violation}`, "verification");
    }
    // Overall pass/fail
    addClaim(`outcome:${bundle.score.pass ? "pass" : "fail"}`, "verification");
    addClaim(`score:${Math.round(bundle.score.total * 100)}`, "verification");
    // ── Diagnosis-based claims ─────────────────────────────────────────
    const diag = bundle.diagnosis;
    addClaim(`localized:${diag.localized_correctly}`, "diagnosis");
    addClaim(`avoided_decoys:${diag.avoided_decoys}`, "diagnosis");
    addClaim(`first_fix_correct:${diag.first_fix_correct}`, "diagnosis");
    addClaim(`self_verified:${diag.self_verified}`, "diagnosis");
    if (diag.failure_mode) {
        addClaim(`failure_mode:${diag.failure_mode}`, "diagnosis");
    }
    // ── Diff-based claims (repo tasks) ─────────────────────────────────
    if (bundle.diff.files_changed.length > 0) {
        for (const file of bundle.diff.files_changed) {
            const sanitized = sanitizeText(file.path);
            addClaim(`file_changed:${sanitized.clean}`, "output");
        }
    }
    // ── Security claims ────────────────────────────────────────────────
    if (bundle.security.injection_scan === "detected") {
        addClaim("security:injection_detected", "output");
    }
    if (bundle.security.anti_cheat_violations > 0) {
        addClaim(`security:anti_cheat_violations:${bundle.security.anti_cheat_violations}`, "output");
    }
    if (bundle.security.forbidden_paths_violations > 0) {
        addClaim(`security:forbidden_paths:${bundle.security.forbidden_paths_violations}`, "output");
    }
    // ── Timeline claims (approach indicators) ──────────────────────────
    const fileReads = bundle.timeline.filter(e => e.type === "file_read").length;
    const fileWrites = bundle.timeline.filter(e => e.type === "file_write").length;
    const shellCmds = bundle.timeline.filter(e => e.type === "shell").length;
    addClaim(`approach:reads=${fileReads},writes=${fileWrites},shells=${shellCmds}`, "output");
    return claims.slice(0, MAX_CLAIMS_PER_MODEL);
}
// ── Consensus Detection ───────────────────────────────────────────────────
function buildConsensusGroups(models) {
    const claimMap = new Map();
    for (const model of models) {
        const modelKey = `${model.provider}/${model.model}`;
        for (const claim of model.claims) {
            if (!claimMap.has(claim.normalized)) {
                claimMap.set(claim.normalized, new Set());
            }
            claimMap.get(claim.normalized).add(modelKey);
        }
    }
    const groups = [];
    for (const [claim, supporters] of claimMap) {
        if (supporters.size >= CONSENSUS_THRESHOLD) {
            groups.push({
                claim,
                supporting_models: Array.from(supporters).sort(),
                count: supporters.size,
            });
        }
    }
    // Sort by count descending, then claim alphabetically
    groups.sort((a, b) => b.count - a.count || a.claim.localeCompare(b.claim));
    return groups;
}
// ── Outlier Detection ─────────────────────────────────────────────────────
function detectOutliers(models, consensus) {
    const consensusClaims = new Set(consensus.map(g => g.claim));
    const outliers = [];
    for (const model of models) {
        const modelKey = `${model.provider}/${model.model}`;
        for (const claim of model.claims) {
            if (!consensusClaims.has(claim.normalized)) {
                // Check it's truly unique (not shared with ANY other model)
                const sharedWithOthers = models.some(m => m.run_id !== model.run_id &&
                    m.claims.some(c => c.normalized === claim.normalized));
                if (!sharedWithOthers) {
                    outliers.push({
                        claim: claim.normalized,
                        model: modelKey,
                        run_id: model.run_id,
                    });
                }
            }
        }
    }
    return outliers;
}
// ── Disagreement Detection ────────────────────────────────────────────────
function detectDisagreements(models) {
    const disagreements = [];
    // Check outcome disagreement
    const passModels = models.filter(m => m.passed).map(m => `${m.provider}/${m.model}`);
    const failModels = models.filter(m => !m.passed).map(m => `${m.provider}/${m.model}`);
    if (passModels.length > 0 && failModels.length > 0) {
        disagreements.push({
            topic: "overall_outcome",
            positions: [
                { claim: "pass", models: passModels },
                { claim: "fail", models: failModels },
            ],
        });
    }
    // Check per-verification-check disagreements
    const checkResults = new Map();
    for (const model of models) {
        const modelKey = `${model.provider}/${model.model}`;
        for (const claim of model.claims) {
            // Parse verification claims like "correctness:check_name:pass"
            const match = claim.normalized.match(/^(correctness|regression):(.+):(pass|fail)$/);
            if (match) {
                const checkName = `${match[1]}:${match[2]}`;
                const result = match[3];
                if (!checkResults.has(checkName)) {
                    checkResults.set(checkName, new Map());
                }
                const positions = checkResults.get(checkName);
                if (!positions.has(result)) {
                    positions.set(result, []);
                }
                positions.get(result).push(modelKey);
            }
        }
    }
    for (const [check, positions] of checkResults) {
        if (positions.size > 1) {
            disagreements.push({
                topic: check,
                positions: Array.from(positions.entries()).map(([claim, modelList]) => ({
                    claim,
                    models: modelList,
                })),
            });
        }
    }
    // Check failure mode disagreements
    const failureModes = new Map();
    for (const model of models) {
        const mode = model.failure_mode ?? "none";
        if (!failureModes.has(mode))
            failureModes.set(mode, []);
        failureModes.get(mode).push(`${model.provider}/${model.model}`);
    }
    if (failureModes.size > 1) {
        disagreements.push({
            topic: "failure_mode",
            positions: Array.from(failureModes.entries()).map(([mode, modelList]) => ({
                claim: mode,
                models: modelList,
            })),
        });
    }
    return disagreements;
}
// ── Truth Alignment ───────────────────────────────────────────────────────
/**
 * Compare model consensus/outliers against deterministic truth.
 * Uses the first bundle's deterministic result as ground truth
 * (all bundles should be for the same task).
 */
function alignWithTruth(models, consensus, outliers) {
    // Find consensus on outcome
    const outcomeConsensus = consensus.find(g => g.claim.startsWith("outcomepass") || g.claim.startsWith("outcomefail"));
    const consensusOutcome = outcomeConsensus?.claim.includes("pass") ? true
        : outcomeConsensus?.claim.includes("fail") ? false
            : null;
    // Find if any outlier got a different outcome
    const outlierModels = new Set(outliers.map(o => o.model));
    const outlierEntries = models.filter(m => outlierModels.has(`${m.provider}/${m.model}`));
    // Determine "truth" from deterministic scores
    // The deterministic judge already scored each bundle. Truth = did the model actually pass?
    // For cross-model synthesis, truth is per-model (each model's deterministic result is authoritative for that model).
    // The interesting signal is: does the majority agree, and is the majority correct?
    const majorityPassed = models.filter(m => m.passed).length > models.length / 2;
    const minorityPassed = !majorityPassed;
    // Check if any outlier (minority) models passed while majority failed (or vice versa)
    const outliersPassed = outlierEntries.some(m => m.passed);
    const outliersPassedWhileMajorityFailed = !majorityPassed && outliersPassed;
    const outlierFailedWhileMajorityPassed = majorityPassed && outlierEntries.some(m => !m.passed);
    // Anti-consensus: majority agrees on outcome but highest-scoring model disagrees
    const bestModel = [...models].sort((a, b) => b.score - a.score)[0];
    const antiConsensus = bestModel
        ? (majorityPassed !== bestModel.passed) || outliersPassedWhileMajorityFailed
        : false;
    const notes = [];
    if (antiConsensus) {
        notes.push("ANTI-CONSENSUS DETECTED: Majority outcome disagrees with best-performing model.");
    }
    if (outliersPassedWhileMajorityFailed) {
        notes.push("Minority model(s) passed while majority failed — minority may be correct.");
    }
    if (outlierFailedWhileMajorityPassed) {
        notes.push("Minority model(s) failed while majority passed — investigate minority weakness.");
    }
    // Score-based truth alignment
    const avgScore = models.reduce((s, m) => s + m.score, 0) / models.length;
    const outlierAvgScore = outlierEntries.length > 0
        ? outlierEntries.reduce((s, m) => s + m.score, 0) / outlierEntries.length
        : 0;
    if (outlierAvgScore > avgScore && outlierEntries.length > 0) {
        notes.push(`Outlier models scored higher (${Math.round(outlierAvgScore * 100)}%) than average (${Math.round(avgScore * 100)}%).`);
    }
    return {
        consensus_correct: majorityPassed,
        outlier_correct: outliersPassed,
        anti_consensus: antiConsensus,
        notes: notes.length > 0 ? notes.join(" ") : "No anomalies detected.",
    };
}
// ── Recommendation ────────────────────────────────────────────────────────
function generateRecommendation(models, truthAlignment) {
    if (models.length === 0)
        return null;
    // Rank by: score (primary), then pass status, then fewer integrity issues
    const ranked = [...models].sort((a, b) => {
        if (a.score !== b.score)
            return b.score - a.score;
        if (a.passed !== b.passed)
            return a.passed ? -1 : 1;
        return 0;
    });
    const best = ranked[0];
    const reasons = [];
    reasons.push(`Highest score: ${Math.round(best.score * 100)}%`);
    if (best.passed)
        reasons.push("Passed deterministic evaluation");
    if (truthAlignment.anti_consensus) {
        reasons.push("Anti-consensus detected — recommendation may differ from majority");
    }
    // Confidence based on score gap
    const secondBest = ranked[1];
    const scoreGap = secondBest ? best.score - secondBest.score : 1;
    let confidence = 0.5;
    if (scoreGap > 0.2)
        confidence = 0.9;
    else if (scoreGap > 0.1)
        confidence = 0.75;
    else if (scoreGap > 0.05)
        confidence = 0.6;
    else
        confidence = 0.4; // Very close scores, low confidence
    if (models.every(m => m.score === best.score)) {
        confidence = 0.3; // All tied
    }
    return {
        best_model: `${best.provider}/${best.model}`,
        reason: reasons.join(". "),
        confidence: Math.round(confidence * 100) / 100,
    };
}
// ── Security Scan ─────────────────────────────────────────────────────────
function scanBundlesForInjection(bundles) {
    const flaggedRunIds = [];
    let totalFlags = 0;
    for (const bundle of bundles) {
        let bundleFlagged = false;
        // Scan timeline details
        for (const event of bundle.timeline) {
            if (event.detail) {
                const scan = scanForInjection(event.detail);
                if (!scan.clean) {
                    bundleFlagged = true;
                    totalFlags += scan.violations.length;
                }
            }
            if (event.command) {
                const scan = scanForInjection(event.command);
                if (!scan.clean) {
                    bundleFlagged = true;
                    totalFlags += scan.violations.length;
                }
            }
        }
        // Scan diff patches
        for (const file of bundle.diff.files_changed) {
            const scan = scanForInjection(file.patch);
            if (!scan.clean) {
                bundleFlagged = true;
                totalFlags += scan.violations.length;
            }
        }
        // Scan integrity violations (untrusted text)
        for (const violation of bundle.verification_results.integrity.violations) {
            const scan = scanForInjection(violation);
            if (!scan.clean) {
                bundleFlagged = true;
                totalFlags += scan.violations.length;
            }
        }
        if (bundleFlagged) {
            flaggedRunIds.push(bundle.bundle_id);
        }
    }
    return {
        synthesis_input_scanned: true,
        synthesis_input_sanitized: true,
        injection_flags_count: totalFlags,
        flagged_run_ids: flaggedRunIds,
    };
}
// ── Main Entry Point ──────────────────────────────────────────────────────
/**
 * Run synthesis analysis across multiple completed evidence bundles.
 * All bundles must be for the same task.
 * Returns a structured, auditable synthesis report.
 *
 * This is pure analysis — no LLM calls, no scoring overrides.
 */
export function runSynthesis(bundles) {
    const timestamp = new Date().toISOString();
    if (bundles.length < 2) {
        return {
            status: "error",
            task_id: bundles[0]?.task.id ?? "unknown",
            run_ids: bundles.map(b => b.bundle_id),
            models: [],
            consensus: [],
            outliers: [],
            disagreements: [],
            truth_alignment: {
                consensus_correct: false,
                outlier_correct: false,
                anti_consensus: false,
                notes: "Synthesis requires at least 2 bundles.",
            },
            recommendation: null,
            security: {
                synthesis_input_scanned: true,
                synthesis_input_sanitized: true,
                injection_flags_count: 0,
                flagged_run_ids: [],
            },
            timestamp,
            error: "Synthesis requires at least 2 bundles for comparison.",
        };
    }
    // Validate all bundles are for the same task
    const taskIds = new Set(bundles.map(b => b.task.id));
    if (taskIds.size > 1) {
        return {
            status: "error",
            task_id: Array.from(taskIds).join(","),
            run_ids: bundles.map(b => b.bundle_id),
            models: [],
            consensus: [],
            outliers: [],
            disagreements: [],
            truth_alignment: {
                consensus_correct: false,
                outlier_correct: false,
                anti_consensus: false,
                notes: "Cannot synthesize bundles from different tasks.",
            },
            recommendation: null,
            security: {
                synthesis_input_scanned: true,
                synthesis_input_sanitized: true,
                injection_flags_count: 0,
                flagged_run_ids: [],
            },
            timestamp,
            error: `Task mismatch: ${Array.from(taskIds).join(", ")}`,
        };
    }
    const taskId = bundles[0].task.id;
    try {
        log("info", "synthesis", `Starting synthesis for task ${taskId} across ${bundles.length} models`);
        // 1. Security scan all inputs
        const security = scanBundlesForInjection(bundles);
        if (security.injection_flags_count > 0) {
            log("warn", "synthesis", `Injection flags detected in ${security.flagged_run_ids.length} bundles — proceeding with sanitized input`);
        }
        // 2. Extract claims per model
        const models = bundles.map(bundle => ({
            provider: bundle.agent.provider,
            model: bundle.agent.model,
            run_id: bundle.bundle_id,
            claims: extractClaims(bundle),
            passed: bundle.score.pass,
            score: bundle.score.total,
            failure_mode: bundle.diagnosis.failure_mode,
        }));
        // 3. Build consensus groups
        const consensus = buildConsensusGroups(models);
        // 4. Detect outliers
        const outliers = detectOutliers(models, consensus);
        // 5. Detect disagreements
        const disagreements = detectDisagreements(models);
        // 6. Truth alignment
        const truthAlignment = alignWithTruth(models, consensus, outliers);
        // 7. Generate recommendation
        const recommendation = generateRecommendation(models, truthAlignment);
        log("info", "synthesis", `Synthesis complete: ${consensus.length} consensus groups, ${outliers.length} outliers, ${disagreements.length} disagreements`);
        if (truthAlignment.anti_consensus) {
            log("warn", "synthesis", `ANTI-CONSENSUS: ${truthAlignment.notes}`);
        }
        return {
            status: "completed",
            task_id: taskId,
            run_ids: bundles.map(b => b.bundle_id),
            models,
            consensus,
            outliers,
            disagreements,
            truth_alignment: truthAlignment,
            recommendation,
            security,
            timestamp,
        };
    }
    catch (err) {
        log("error", "synthesis", `Synthesis failed: ${String(err)}`);
        return {
            status: "error",
            task_id: taskId,
            run_ids: bundles.map(b => b.bundle_id),
            models: [],
            consensus: [],
            outliers: [],
            disagreements: [],
            truth_alignment: {
                consensus_correct: false,
                outlier_correct: false,
                anti_consensus: false,
                notes: `Synthesis error: ${String(err)}`,
            },
            recommendation: null,
            security: {
                synthesis_input_scanned: false,
                synthesis_input_sanitized: false,
                injection_flags_count: 0,
                flagged_run_ids: [],
            },
            timestamp,
            error: String(err),
        };
    }
}
// ── Exported utilities for testing ────────────────────────────────────────
export { extractClaims, normalizeClaim, stripCodeBlocks, buildConsensusGroups, detectOutliers, detectDisagreements, alignWithTruth, generateRecommendation, sanitizeText, scanBundlesForInjection, };
//# sourceMappingURL=synthesis.js.map