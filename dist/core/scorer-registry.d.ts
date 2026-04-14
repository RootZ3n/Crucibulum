/**
 * Crucibulum — Scorer Registry
 * Loads, validates, and manages custom scorer plugins from the /scorers/ directory.
 * Invalid plugins fail loudly at load time — no silent swallowing.
 */
export interface ScorerInput {
    taskId: string;
    taskFamily: string;
    modelResponse: string;
    oracleData: Record<string, unknown>;
    metadata: Record<string, unknown>;
}
export interface ScorerOutput {
    score: number;
    passed: boolean;
    breakdown: Record<string, number>;
    explanation: string;
    metadata?: Record<string, unknown>;
}
export interface ScorerPlugin {
    id: string;
    name: string;
    version: string;
    taskFamilies: string[];
    score(input: ScorerInput): ScorerOutput;
}
export declare function setScorersDir(dir: string): void;
export declare function loadAllScorers(): Promise<{
    loaded: number;
    failed: Array<{
        path: string;
        error: string;
    }>;
}>;
export declare function getScorer(id: string): ScorerPlugin | undefined;
export declare function listScorers(): Array<{
    id: string;
    name: string;
    version: string;
    taskFamilies: string[];
    sourcePath: string;
}>;
export declare function findScorersForFamily(taskFamily: string): ScorerPlugin[];
/** Clear all loaded scorers (for testing) */
export declare function clearScorers(): void;
//# sourceMappingURL=scorer-registry.d.ts.map