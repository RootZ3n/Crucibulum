/**
 * Crucible — Score Store
 * SQLite-backed score storage with query and leaderboard support.
 */
import { type ModelScore, type ScoreSource, type ScoreFamily, type LeaderboardEntry } from "../types/scores.js";
export declare function storeScores(scores: ModelScore[], source: ScoreSource, runId?: string): {
    stored: number;
    errors: string[];
};
export interface ScoreQuery {
    modelId?: string | undefined;
    family?: string | undefined;
    taskId?: string | undefined;
    source?: string | undefined;
    limit?: number | undefined;
}
export declare function queryScores(query: ScoreQuery): ModelScore[];
export declare function getLeaderboard(families?: ScoreFamily[]): LeaderboardEntry[];
//# sourceMappingURL=score-store.d.ts.map