export * from "./test-log-triage.js";
export * from "./repo-reconnaissance.js";

import { TEST_LOG_TRIAGE_EVALUATION_IDS } from "./test-log-triage.js";
import { REPO_RECON_EVALUATION_IDS } from "./repo-reconnaissance.js";

/**
 * Which split a fixture belongs to.
 *
 * A single source of truth, so development and evaluation cannot drift apart or
 * overlap. A fixture listed in both would be a policy violation rather than a
 * merge conflict, and `assertSplitsDisjoint` makes it a load-time error.
 */
export function isEvaluationFixture(id: string): boolean {
  return (TEST_LOG_TRIAGE_EVALUATION_IDS as readonly string[]).includes(id)
    || (REPO_RECON_EVALUATION_IDS as readonly string[]).includes(id);
}

export const ALL_EVALUATION_IDS: readonly string[] = Object.freeze([
  ...TEST_LOG_TRIAGE_EVALUATION_IDS,
  ...REPO_RECON_EVALUATION_IDS,
]);

/** Throws if any id appears in more than one split. */
export function assertSplitsDisjoint(): void {
  const seen = new Set<string>();
  for (const id of ALL_EVALUATION_IDS) {
    if (seen.has(id)) throw new Error(`fixture ${id} appears in more than one evaluation split`);
    seen.add(id);
  }
}
