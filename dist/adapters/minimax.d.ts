/**
 * Crucible — MiniMax Direct Adapter
 * Direct MiniMax API integration via OpenAI-compatible endpoint.
 * Supported: MiniMax-M2.7, abab6.5s-chat
 *
 * CLI: --adapter minimax --model MiniMax-M2.7
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult, ChatMessage, ChatResult, ChatOptions } from "./base.js";
export declare class MiniMaxAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private model;
    private apiKey;
    private baseUrl;
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    supportsChat(): boolean;
    chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResult>;
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
//# sourceMappingURL=minimax.d.ts.map