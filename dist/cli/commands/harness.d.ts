/**
 * Crucible CLI — `harness` command
 *
 * Comprehensive QA / regression harness for Ricky, Ptah, and any other
 * verifying agent. Walks every tab/lane, every test in each lane, runs each
 * one in a controlled mode, and validates the pipeline end-to-end:
 *
 *   1. test can start                       — manifest loads cleanly
 *   2. model request is sent                — adapter.chat()/execute() runs
 *   3. response is received                 — non-empty model output recorded
 *   4. judge/scorer runs                    — deterministic + (optional) model
 *   5. result is recorded                   — bundle stored on disk
 *   6. UI can display the result            — summary contract is well-formed
 *   7. drilldown evidence is present        — prompt, answer, expected,
 *                                              judgement, reason, cost/tokens
 *
 * The harness emits a machine-readable JSON report (default destination
 * `runs/_harness_report_<timestamp>.json`) that downstream agents consume.
 *
 * Usage
 * -----
 *   npm run harness                      # offline, harness-mock adapter
 *   npm run harness -- --tab personality # only run the Personality lane
 *   npm run harness -- --task spec-001   # run a single test by id
 *   npm run harness -- --live            # use the configured judge model
 *                                        #   (OpenRouter MiMo by default)
 *                                        #   for all chat() calls and the
 *                                        #   review layer; needs an API key
 *
 *   node dist/cli/main.js harness ...
 */
interface LaneSpec {
    key: string;
    label: string;
    taskFamilies: string[];
    /** Hint about what the lane covers — surfaced in the report. */
    headline: string;
}
/** Mirror of TAB_CONFIG in ui/index.html. Single source of truth in the harness. */
export declare const HARNESS_LANES: LaneSpec[];
export declare function harnessCommand(rawArgs: string[]): Promise<void>;
export {};
//# sourceMappingURL=harness.d.ts.map