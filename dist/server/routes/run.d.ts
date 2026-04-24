/**
 * Crucible — Run Routes
 * Single task execution, run queries, SSE streaming.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EvidenceBundle } from "../../adapters/base.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { summarizeRunSet } from "../contracts.js";
import type { StructuredProviderError } from "../../types/provider-error.js";
interface ActiveRun {
    id: string;
    status: "running" | "complete" | "error";
    events: string[];
    bundle?: EvidenceBundle | undefined;
    bundles?: EvidenceBundle[] | undefined;
    aggregate?: ReturnType<typeof summarizeRunSet> | undefined;
    error?: string | undefined;
    provider_error?: StructuredProviderError | undefined;
    request?: {
        task: string;
        adapter: string;
        provider: string | null;
        model: string;
        count: number;
        judge: typeof DETERMINISTIC_JUDGE_METADATA;
    } | undefined;
    failure_stage?: "preflight" | "adapter_init" | "health_check" | "execution" | "unknown" | undefined;
}
export declare const activeRuns: Map<string, ActiveRun>;
export declare const sseClients: Map<string, ServerResponse<IncomingMessage>[]>;
export declare function markRunSettled(runId: string): void;
export declare function broadcastSSE(runId: string, event: string, data: unknown): void;
export declare function handleRunsList(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleRunSummary(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
export declare function handleRunGet(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
export declare function handleStats(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleReceipts(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleCompare(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
export declare function handleRunStatus(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
export declare function handleRunPost(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleRunLive(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
export declare function handleCrucibleLink(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
export {};
//# sourceMappingURL=run.d.ts.map