/**
 * Crucible — OpenAI-compatible Adapter
 * Agentic loop over any OpenAI chat-completions-compatible API.
 * Used for OpenRouter, OpenAI, and any compatible endpoint.
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult, ChatMessage, ChatResult, ChatOptions } from "./base.js";
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
    supportsChat(): boolean;
    chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
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
    private callAPI;
}
export declare function buildOpenRouterChatBody(adapterId: string, baseUrl: string, model: string, messages: Array<{
    role: string;
    content: string;
}>, options?: ChatOptions): Record<string, unknown>;
//# sourceMappingURL=openrouter.d.ts.map