/**
 * Crucibulum — Z.AI Direct Adapter (GLM / Zhipu)
 * Direct BigModel API integration (OpenAI-compatible).
 * Supported: glm-4-plus, glm-5.1, glm-z1-flash, glm-4-air
 *
 * CLI: --adapter zai --model glm-4-plus
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class ZAIAdapter implements CrucibulumAdapter {
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
//# sourceMappingURL=zai.d.ts.map