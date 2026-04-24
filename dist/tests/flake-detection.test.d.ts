/**
 * Crucible — Flake Detection Tests
 *
 * Stats math for retry/flake aggregation. Originally written against vitest
 * with `vi.mock` to stub the runner; ported to node:test, using the
 * `_runTask` injection on `FlakeRunOptions` so the runner can be supplied
 * directly without module-level mocking. Logic the tests cover (stable_pass,
 * stable_fail, flaky_pass, flaky_fail, first-run preservation, attempt
 * numbering) is unchanged.
 */
export {};
//# sourceMappingURL=flake-detection.test.d.ts.map