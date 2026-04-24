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
export declare const TEST_DISPLAY_NAMES: Readonly<Record<string, string>>;
/**
 * Resolve a human-readable name from a manifest. Accepts a partial manifest
 * shape so callers don't need to know whether the task is repo-based or
 * conversational.
 */
export declare function resolveDisplayName(manifest: {
    id: string;
    display_name?: string | undefined;
    task?: {
        title?: string | undefined;
    } | undefined;
    description?: string | undefined;
} | null | undefined, fallbackId?: string): string;
export declare function listDisplayNameOverrides(): Array<{
    id: string;
    display_name: string;
}>;
//# sourceMappingURL=test-names.d.ts.map