/**
 * Crucibulum — Claude Code Adapter
 * Invokes the Claude Code CLI binary to solve tasks.
 * Uses --print mode for non-interactive execution.
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult } from "./base.js";
export declare class ClaudeCodeAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private binaryPath;
    private model;
    private binaryHash;
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    init(config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<{
        ok: boolean;
        reason?: string | undefined;
    }>;
    teardown(): Promise<void>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
    private parseOutput;
    private snapshotFiles;
    private detectChanges;
}
//# sourceMappingURL=claudecode.d.ts.map