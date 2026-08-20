/**
 * The existing FailureReasonCode union, restated as a runtime array.
 *
 * TypeScript unions vanish at runtime, so a test that wants to prove "every
 * local code maps onto a code that really exists" needs the list as data. Kept
 * beside the tests rather than exported from types/verdict.ts so that adding a
 * legacy code is a deliberate edit in two places, and a typo here fails the
 * mapping test rather than silently widening what counts as valid.
 */
import type { FailureReasonCode } from "../../types/verdict.js";

export const FAILURE_REASON_CODES_FOR_TEST: readonly FailureReasonCode[] = [
  "pass", "low_score", "wrong_output", "model_output_malformed", "contract_violation",
  "invalid_tool_shape", "incomplete_output", "execution_timeout", "budget_exceeded",
  "provider_timeout", "provider_rate_limited", "provider_http_5xx", "provider_http_error",
  "provider_invalid_response", "provider_auth_error", "provider_unavailable",
  "provider_process_error", "provider_empty_response", "provider_error",
  "network_connection_reset", "network_dns_failure", "network_unreachable", "network_error",
  "test_command_timeout", "test_fixture_failure", "test_harness_failure",
  "judge_command_timeout", "judge_not_evaluable", "judge_failure",
  "harness_preflight_failure", "harness_runtime_failure", "runner_environment_error",
  "cancelled", "unknown_failure",
];
