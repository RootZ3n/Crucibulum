import type { EvidenceBundle } from "../adapters/base.js";
import type { StructuredProviderError } from "../types/provider-error.js";
import type { NormalizedVerdict } from "../types/verdict.js";
export interface JudgeCommandResult {
    id: string;
    scope: "correctness" | "regression";
    command: string;
    status: "pass" | "fail" | "error" | "unsupported";
    summary: string;
    exitCode?: number | null;
    timedOut?: boolean | undefined;
    stdout?: string | undefined;
    stderr?: string | undefined;
    errorKind?: "timeout" | "spawn_error" | "runtime_error" | "unevaluable" | undefined;
}
export interface VerdictInput {
    bundle: Pick<EvidenceBundle, "agent" | "score" | "diagnosis" | "verification_results" | "timeline"> & {
        verdict?: NormalizedVerdict | undefined;
    };
    executionMode?: "repo" | "conversational";
    exitReason?: string | null;
    rawError?: string | null;
    providerError?: StructuredProviderError | null;
    attemptCount?: number | null;
    retries?: number | null;
}
export declare function normalizeVerdict(input: VerdictInput): NormalizedVerdict;
export declare function normalizeBundleVerdict(bundle: EvidenceBundle): NormalizedVerdict;
//# sourceMappingURL=verdict.d.ts.map