import type { StructuredProviderError } from "./provider-error.js";
export type CompletionState = "PASS" | "FAIL" | "NC";
export type FailureOrigin = "MODEL" | "PROVIDER" | "NETWORK" | "TEST" | "JUDGE" | "HARNESS" | "UNKNOWN";
export type FailureReasonCode = "pass" | "low_score" | "wrong_output" | "model_output_malformed" | "contract_violation" | "invalid_tool_shape" | "incomplete_output" | "execution_timeout" | "budget_exceeded" | "provider_timeout" | "provider_rate_limited" | "provider_http_5xx" | "provider_http_error" | "provider_invalid_response" | "provider_auth_error" | "provider_unavailable" | "provider_process_error" | "provider_empty_response" | "provider_error" | "network_connection_reset" | "network_dns_failure" | "network_unreachable" | "network_error" | "test_command_timeout" | "test_fixture_failure" | "test_harness_failure" | "judge_command_timeout" | "judge_not_evaluable" | "judge_failure" | "harness_preflight_failure" | "harness_runtime_failure" | "cancelled" | "unknown_failure";
export interface VerdictEvidence {
    provider: string | null;
    adapter: string | null;
    exitReason: string | null;
    rawError: string | null;
    providerError: StructuredProviderError | null;
    httpStatus: number | null;
    timeout: boolean;
    judgeError: string | null;
    testError: string | null;
    attemptCount: number | null;
    retries: number | null;
}
export interface NormalizedVerdict {
    completionState: CompletionState;
    failureOrigin: FailureOrigin | null;
    failureReasonCode: FailureReasonCode;
    failureReasonSummary: string;
    countsTowardModelScore: boolean;
    countsTowardFailureRate: boolean;
    evidence: VerdictEvidence;
}
export declare const PASS_VERDICT: NormalizedVerdict;
//# sourceMappingURL=verdict.d.ts.map