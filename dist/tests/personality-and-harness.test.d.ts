/**
 * Personality + harness regression coverage.
 *
 * Pins the four behaviours the user explicitly called out:
 *
 *   1. Empty answer must not silently pass on absence-of-X scorers
 *      (hedge_count / corporate_check). Personality-tab tests scoring 100%
 *      on a model that returned nothing was the original reliability bug.
 *   2. Personality manifests load through the conversational runner with
 *      family="personality" — confirms the lane filter wires up.
 *   3. The conversational judge surfaces SILENT_PASS / NO_TOKENS_REPORTED
 *      anomalies for the harness to flag.
 *   4. The harness mock adapter produces a scorer-aware reply per
 *      scoring_type so the harness can validate every personality test
 *      without a live provider.
 *   5. The judge_usage bundle field is always defined on conversational
 *      bundles, kind="deterministic" with zero values when no model judge
 *      ran — so the UI can render judge cost without branching.
 */
export {};
//# sourceMappingURL=personality-and-harness.test.d.ts.map