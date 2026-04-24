/**
 * Crucible — Grimoire Codex Adapter
 * Routes tasks through Squidley's Grimoire Codex mode.
 * Codex Mode = iterative inspect/edit/verify loop.
 *
 * CLI usage:
 *   --adapter grimoire-codex --model gpt-5.4
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class GrimoireCodexAdapter implements CrucibulumAdapter {
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
        reason: string;
        providerError: import("../types/provider-error.js").StructuredProviderError;
    } | {
        ok: boolean;
        reason?: never;
        providerError?: never;
    }>;
    teardown(): Promise<void>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
}
//# sourceMappingURL=grimoire-codex.d.ts.map