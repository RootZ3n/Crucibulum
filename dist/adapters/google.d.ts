/**
 * Crucibulum — Google AI Direct Adapter
 * Direct Gemini API integration via generativelanguage.googleapis.com.
 * Uses Google's native content format (role: "model", parts: [{text}]).
 * API key passed as URL query parameter, not auth header.
 *
 * Supported: gemini-2.0-flash, gemini-1.5-pro, gemini-3.1-pro
 * CLI: --adapter google --model gemini-2.0-flash
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class GoogleAdapter implements CrucibulumAdapter {
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
//# sourceMappingURL=google.d.ts.map