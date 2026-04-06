/**
 * Crucibulum — OpenAI-compatible Adapter
 * Agentic loop over any OpenAI chat-completions-compatible API.
 * Used for OpenRouter, OpenAI, and any compatible endpoint.
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export interface OpenAICompatibleAdapterOpts {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    defaultModel?: string;
}
export declare class OpenRouterAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private baseUrl;
    private apiKeyEnv;
    private apiKey;
    private model;
    constructor(opts?: OpenAICompatibleAdapterOpts);
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    init(config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<{
        ok: boolean;
        reason?: string | undefined;
    }>;
    teardown(): Promise<void>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
    private callAPI;
}
//# sourceMappingURL=openrouter.d.ts.map