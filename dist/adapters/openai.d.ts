/**
 * Crucibulum — OpenAI Direct Adapter
 * Direct OpenAI Chat Completions API integration.
 * Handles reasoning models (o1, o3) which require max_completion_tokens
 * and do not support temperature.
 *
 * Supported: gpt-5.4, gpt-5.4-mini, o3, o1
 * CLI: --adapter openai --model gpt-5.4
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class OpenAIAdapter implements CrucibulumAdapter {
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
//# sourceMappingURL=openai.d.ts.map