/**
 * Crucible — Human-Readable Test Names
 *
 * Side table mapping internal task IDs (e.g. "spec-001") to short, plain-
 * language names that a non-engineer can scan ("Follows Output Format").
 * Internal IDs stay stable so run history, leaderboard joins, and bundle
 * filenames don't break — this layer is presentation-only.
 *
 * Resolution rules
 *   1. If the manifest already supplies a `display_name`, prefer that —
 *      manifests own their own labels.
 *   2. Otherwise consult this map.
 *   3. Otherwise fall back to manifest.task.title for repo tasks, or
 *      manifest.description for conversational tasks, then the raw ID.
 *
 * Style guide
 *   - 3–6 words, sentence case-ish title case
 *   - States what the test *does*, not how it's scored
 *   - Avoid jargon; "Follows Output Format" beats "Spec Discipline"
 */

export const TEST_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  // Repo execution: spec_discipline
  "spec-001": "Follows Output Format",
  "spec-002": "Pagination Cursor Discipline",
  "spec-003": "Date Format Compliance",
  "spec-004": "Cache Invalidation Discipline",
  "spec-005": "No Internal Path Leakage",

  // Repo execution: poison_localization
  "poison-001": "Locates Auth Bug",
  "poison-002": "Locates Sequence-Number Race",
  "poison-003": "Locates Lost-Write Bug",
  "poison-004": "Locates Config Loader Bug",
  "poison-005": "Locates Rounding Bug",
  "poison-006": "Locates Email Validator Slowdown",

  // Repo execution: orchestration
  "coord-001": "Multi-Step: Duplicate-Email Fix",
  "coord-002": "Multi-Step: Receipt-Total Fix",
  "coord-003": "Multi-Step: Cache Corruption Fix",
  "coord-004": "Multi-Step: Search Performance Fix",

  // Conversational: personality
  "personality-001": "Answers Directly Without Hedging",
  "personality-002": "Avoids Corporate Filler",
  "personality-003": "Refuses to Fabricate Data",
  "personality-004": "Maintains Consistent Tone",
  "personality-005": "Knows Its Own Configuration",

  // Conversational: identity / "personality" tab spillover
  "identity-squidley-001": "Self-Knowledge Probe",
  "classification-001": "Single-Word Classification",
  "instruction-obedience-001": "Follows Output-Shape Instructions",
  "prompt-sensitivity-001": "Resists Prompt Overfitting",
  "role-stress-001": "Maintains Role Under Pressure",

  // Conversational: truthfulness / benchmark tab
  "truthfulness-001": "Admits Ignorance Instead of Fabricating",
  "truthfulness-002": "Recalls Facts Mentioned Earlier",
  "code-001": "Writes Working Small-Code Tasks",
  "context-degradation-001": "Reads Long Contexts Without Drift",
  "reasoning-001": "Reaches Verifiable Correct Answers",
  "summarization-001": "Summarizes Without Losing Facts",
  "workflow-001": "Turns Messy Input into Structured Output",

  // Conversational: cost_efficiency
  "thinking-mode-001": "Thinking-Mode Delta Probe",
  "token-efficiency-001": "Solves at Lower Token Cost",

  // Safety
  "safety-001": "Holds Boundary Through Roleplay",
  "safety-002": "Refuses Child-Safety Requests",
  "safety-003": "Holds Boundary Under Repeated Pressure",

  // Memory
  "memory-001": "Cross-Turn Recall",
  "memory-002": "Honest Uncertainty About History",
  "memory-003": "Resists Context Poisoning",
});

/**
 * Resolve a human-readable name from a manifest. Accepts a partial manifest
 * shape so callers don't need to know whether the task is repo-based or
 * conversational.
 */
export function resolveDisplayName(manifest: { id: string; display_name?: string | undefined; task?: { title?: string | undefined } | undefined; description?: string | undefined } | null | undefined, fallbackId?: string): string {
  if (!manifest) return fallbackId ?? "unknown";
  if (typeof manifest.display_name === "string" && manifest.display_name.trim().length > 0) {
    return manifest.display_name.trim();
  }
  const mapped = TEST_DISPLAY_NAMES[manifest.id];
  if (mapped) return mapped;
  if (manifest.task?.title) return manifest.task.title;
  if (manifest.description) return manifest.description.split(/[.—]/)[0]!.trim();
  return manifest.id;
}

export function listDisplayNameOverrides(): Array<{ id: string; display_name: string }> {
  return Object.entries(TEST_DISPLAY_NAMES).map(([id, display_name]) => ({ id, display_name }));
}
