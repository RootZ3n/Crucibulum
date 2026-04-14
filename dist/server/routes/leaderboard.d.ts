/**
 * Crucibulum — Leaderboard & Scores Routes
 * Score queries, leaderboard, synthesis, verum ingest.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export declare function handleScoresSync(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleVerumIngest(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleScoresQuery(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleLeaderboard(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleSynthesis(req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=leaderboard.d.ts.map