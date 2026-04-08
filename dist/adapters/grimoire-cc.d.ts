/**
 * Crucibulum — Grimoire CC Adapter
 * Routes tasks through Squidley's Grimoire CC mode.
 * CC Mode = non-blocking approval flow, file editing with approval gates.
 * For benchmark runs, auto_approve is set to true.
 *
 * CLI usage:
 *   --adapter grimoire-cc --model mimo-v2-pro
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class GrimoireCCAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private url;
    private model;
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    supportsChat(): boolean;
    init(config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<{
        ok: boolean;
        reason?: string | undefined;
    }>;
    teardown(): Promise<void>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
}
//# sourceMappingURL=grimoire-cc.d.ts.map