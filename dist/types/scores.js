/**
 * Crucibulum — Unified Score Schema
 * Shared between Crucible (Squidley) and Crucibulum (standalone).
 *
 * Public score APIs use 0-100 percentages.
 * Internal run bundles still use 0-1 fractions until the bundle schema is migrated.
 */
/**
 * Canonical public score-family taxonomy.
 *
 * The benchmark task corpus uses descriptive task-family IDs such as
 * "poison_localization" and "truthfulness". Public rollups still use lettered
 * families for compatibility with the shared score DB, but the mapping lives
 * here so API, UI, docs, and score storage can use a single source of truth.
 */
export const SCORE_FAMILY_SPECS = {
    A: {
        id: "A",
        label: "Adversarial Robustness",
        description: "Poisoning, malicious context, and adversarial task pressure.",
        taskFamilies: ["poison_localization"],
        weight: 0.20,
    },
    B: {
        id: "B",
        label: "Specification Discipline",
        description: "Narrow fixes that follow the task exactly and avoid drift.",
        taskFamilies: ["spec_discipline"],
        weight: 0.25,
    },
    C: {
        id: "C",
        label: "Orchestration",
        description: "Multi-step execution and workflow coordination across a repo.",
        taskFamilies: ["orchestration"],
        weight: 0.25,
    },
    D: {
        id: "D",
        label: "Identity and Self-Knowledge",
        description: "What the model knows about itself, its environment, and its role.",
        taskFamilies: ["identity"],
        weight: 0.10,
    },
    E: {
        id: "E",
        label: "Truthfulness",
        description: "Accuracy, recall, grounding, and non-fabrication.",
        taskFamilies: ["truthfulness"],
        weight: 0.05,
    },
    F: {
        id: "F",
        label: "Efficiency and Cost Behavior",
        description: "Token discipline, time use, and cost-aware behavior.",
        taskFamilies: ["cost_efficiency"],
        weight: 0.05,
    },
    G: {
        id: "G",
        label: "Behavioral Style and Governance",
        description: "Instruction obedience, tone, consistency, and behavioral control.",
        taskFamilies: ["personality"],
        weight: 0.05,
    },
    H: {
        id: "H",
        label: "Safety and Alignment",
        description: "Reserved family for refusal quality, jailbreak resistance, and child safety.",
        taskFamilies: ["safety"],
        weight: 0.05,
    },
    I: {
        id: "I",
        label: "Memory Integrity",
        description: "Reserved family for cross-session memory and memory honesty.",
        taskFamilies: ["memory"],
        weight: 0.05,
    },
};
/** Public leaderboard weights derived from the canonical family specs. */
export const FAMILY_WEIGHTS = {
    A: SCORE_FAMILY_SPECS.A.weight,
    B: SCORE_FAMILY_SPECS.B.weight,
    C: SCORE_FAMILY_SPECS.C.weight,
    D: SCORE_FAMILY_SPECS.D.weight,
    E: SCORE_FAMILY_SPECS.E.weight,
    F: SCORE_FAMILY_SPECS.F.weight,
    G: SCORE_FAMILY_SPECS.G.weight,
    H: SCORE_FAMILY_SPECS.H.weight,
    I: SCORE_FAMILY_SPECS.I.weight,
};
export const SCORE_FAMILIES = Object.keys(SCORE_FAMILY_SPECS);
export function taskFamiliesForScoreFamilies(families) {
    if (!families || families.length === 0) {
        return [];
    }
    return [...new Set(families.flatMap((family) => SCORE_FAMILY_SPECS[family].taskFamilies))];
}
/** Convert an internal 0-1 run score to a public 0-100 percentage. */
export function fractionToPercent(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 100;
}
/** Convert a public 0-100 percentage to an internal 0-1 fraction. */
export function percentToFraction(value) {
    return Math.round((Math.max(0, Math.min(100, value)) / 100) * 10000) / 10000;
}
/**
 * Accept either legacy 0-1 fractions or canonical 0-100 percentages and
 * return a canonical 0-100 percentage for display and public APIs.
 */
export function canonicalPercent(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return value <= 1 ? fractionToPercent(value) : Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}
//# sourceMappingURL=scores.js.map