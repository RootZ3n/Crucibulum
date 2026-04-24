import { canonicalPercent } from "../types/scores.js";
function normalizeVerumResult(request, result) {
    const normalizedScore = canonicalPercent(result.score);
    const normalizedRawScore = canonicalPercent(result.rawScore ?? result.score);
    return {
        modelId: request.modelId,
        taskId: result.caseId,
        family: result.family ?? "A",
        category: result.category,
        passed: result.passed,
        score: normalizedScore,
        rawScore: normalizedRawScore,
        duration_ms: result.duration_ms,
        tokensUsed: result.tokensUsed,
        costEstimate: result.costEstimate,
        anomalyFlags: result.anomalyFlags,
        timestamp: result.timestamp,
        completionState: result.passed ? "PASS" : "FAIL",
        failureOrigin: result.passed ? null : "MODEL",
        failureReasonCode: result.passed ? "pass" : "wrong_output",
        failureReasonSummary: result.passed ? "Attack evaluation passed" : "Attack evaluation failed",
        countsTowardModelScore: true,
        countsTowardFailureRate: !result.passed,
        metadata: {
            provider: request.provider,
            adapter: request.adapter,
            verum_case_id: result.caseId,
            attack_class: result.attackClass,
            transcript_hash: result.transcriptHash ?? null,
            rubric_version: result.rubricVersion ?? null,
            notes: result.notes ?? null,
            source: "verum",
        },
    };
}
export function normalizeVerumIngest(request) {
    return request.results.map((result) => normalizeVerumResult(request, result));
}
//# sourceMappingURL=verum.js.map