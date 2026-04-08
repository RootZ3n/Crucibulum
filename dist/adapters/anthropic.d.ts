/**
 * Crucibulum — Anthropic Direct Adapter
 * Direct Anthropic Messages API integration.
 * Supports: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
 *
 * CLI: --adapter anthropic --model claude-opus-4-6
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class AnthropicAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private model;
    private apiKey;
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
//# sourceMappingURL=anthropic.d.ts.map