/**
 * Crucibulum — Ollama Adapter
 * Direct Ollama API integration for local model evaluation.
 * Implements an agentic loop with lenient command parsing and structured logging.
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult, ChatMessage, ChatResult } from "./base.js";
export declare class OllamaAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private url;
    private model;
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsChat(): boolean;
    supportsToolCalls(): boolean;
    init(config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<{
        ok: boolean;
        reason?: string | undefined;
    }>;
    teardown(): Promise<void>;
    chat(messages: ChatMessage[]): Promise<ChatResult>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
}
//# sourceMappingURL=ollama.d.ts.map