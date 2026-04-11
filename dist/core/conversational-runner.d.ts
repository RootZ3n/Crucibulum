/**
 * Crucibulum — Conversational Runner
 * Executes chat-based tests: sends questions via adapter.chat(),
 * scores responses deterministically, produces evidence bundles.
 *
 * Flow:
 *   1. Load conversational manifest
 *   2. For each question:
 *      a. Send optional setup messages (with gap fillers for recall)
 *      b. Send question
 *      c. Score response
 *   3. Aggregate scores via conversational judge
 *   4. Build evidence bundle
 */
import type { CrucibulumAdapter, ConversationalManifest, ChatMessage, EvidenceBundle } from "../adapters/base.js";
export declare function loadPersistedConversation(sessionId: string): ChatMessage[];
export declare function persistConversation(sessionId: string, messages: ChatMessage[]): void;
export declare function loadConversationalManifest(taskId: string): ConversationalManifest;
export declare function isConversationalTask(taskId: string): boolean;
export interface ConversationalRunOptions {
    taskId: string;
    adapter: CrucibulumAdapter;
    model: string;
    /** Override system prompt (optional) */
    systemPrompt?: string | undefined;
}
export interface ConversationalRunResult {
    bundle: EvidenceBundle;
    passed: boolean;
    score: number;
    exitCode: number;
}
export interface ConversationalEfficiencyResult {
    time_sec: number;
    time_limit_sec: number;
    steps_used: number;
    steps_limit: number;
    score: number;
}
export declare function computeConversationalEfficiency(manifest: ConversationalManifest, totalDurationMs: number, totalTokensIn: number, totalTokensOut: number): ConversationalEfficiencyResult;
export declare function runConversationalTask(options: ConversationalRunOptions): Promise<ConversationalRunResult>;
//# sourceMappingURL=conversational-runner.d.ts.map