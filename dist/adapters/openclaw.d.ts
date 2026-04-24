/**
 * Crucible — OpenClaw Adapter
 * Invokes OpenClaw as a subprocess in the workspace.
 * OpenClaw operates autonomously — reads files, runs commands, writes fixes.
 * Crucible observes its actions via stdout/file system monitoring.
 */
import type { CrucibulumAdapter, AdapterConfig, HealthCheckResult, ExecutionInput, ExecutionResult } from "./base.js";
export declare class OpenClawAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private binaryPath;
    private configPath;
    private model;
    private provider;
    private binaryHash;
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    supportsChat(): boolean;
    init(config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<HealthCheckResult>;
    teardown(): Promise<void>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
    private resolveBinary;
}
//# sourceMappingURL=openclaw.d.ts.map