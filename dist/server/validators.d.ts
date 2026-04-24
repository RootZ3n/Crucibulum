/**
 * Crucible — Runtime request-body validation
 *
 * Tiny, dependency-free validators for the handful of POST routes that accept
 * structured payloads. Intentionally not a generic schema framework — every
 * route already has a TypeScript shape, and these validators exist only so
 * malformed runtime input fails fast with a clear 400 instead of sneaking
 * past compile-time types and silently coercing.
 */
export type ValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    errors: string[];
};
export interface RunRequest {
    task: string;
    model: string;
    adapter: string;
    provider: string | null;
    count: number;
    secondOpinion?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
    qcReview?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
}
export interface RunSuiteRequest {
    model: string;
    adapter: string;
    provider: string | null;
    suite_id?: string;
    flake_detection?: {
        enabled?: boolean;
        retries?: number;
    };
    secondOpinion?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
    qcReview?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
}
export interface RunBatchRequest {
    task: string;
    models: Array<{
        adapter: string;
        provider: string | null;
        model: string;
    }>;
    auto_synthesis: boolean;
    secondOpinion?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
    qcReview?: {
        enabled?: boolean;
        provider?: string;
        model?: string;
    };
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
    completionState?: string;
    failureOrigin?: string | null;
    failureReasonCode?: string;
    failureReasonSummary?: string;
    countsTowardModelScore?: boolean;
    countsTowardFailureRate?: boolean;
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
export declare function validateRunRequest(raw: unknown): ValidationResult<RunRequest>;
export declare function validateRunSuiteRequest(raw: unknown): ValidationResult<RunSuiteRequest>;
export declare function validateRunBatchRequest(raw: unknown): ValidationResult<RunBatchRequest>;
export declare function validateScoresSyncRequest(raw: unknown): ValidationResult<ScoresSyncRequest>;
export declare function validateSynthesisRequest(raw: unknown): ValidationResult<SynthesisRequest>;
export declare function validateCrucibleLinkRequest(raw: unknown): ValidationResult<CrucibleLinkRequest>;
//# sourceMappingURL=validators.d.ts.map