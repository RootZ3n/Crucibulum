/**
 * Crucible — Squidley Gateway Adapter
 * Routes all model calls through the Squidley API, giving Crucible access
 * to every model Squidley knows: ModelStudio (qwen3.5-plus, qwen3.6-plus),
 * OpenRouter (MiMo, Trinity), Anthropic (Opus, Sonnet), MiniMax, Ollama, etc.
 *
 * Implements the same agentic loop as ollama.ts:
 *   send task prompt → parse READ_FILE/WRITE_FILE/SHELL/DONE → execute tools → loop
 *
 * CLI usage:
 *   --model squidley:qwen3.6-plus
 *   --model squidley:claude-opus-4-6
 *   --model squidley:mimo-v2-pro
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult, ChatMessage, ChatResult, ChatOptions } from "./base.js";
export declare class SquidleyAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private url;
    private model;
    private provider;
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
//# sourceMappingURL=squidley.d.ts.map