/**
 * Crucible — Harness Mock Adapter
 *
 * A deterministic, offline adapter built specifically for the QA harness
 * (`crucible harness` / `npm run harness`). It is NOT registered in the
 * normal adapter registry and is never picked by the production /api/run
 * dispatcher — the harness CLI instantiates it directly so Ricky/Ptah can
 * validate every tab and every test without burning real API credits or
 * needing network access.
 *
 * Behaviour
 * ---------
 *  - chat(messages): returns a stubbed text response that satisfies most
 *    deterministic conversational scorers (text_match, refusal_check,
 *    refusal_quality, hedge_count, corporate_check, recall, regex_match,
 *    text_match_all). Reports realistic-looking token counts and a small
 *    estimated cost so token/cost transparency code paths are exercised.
 *  - execute(input): returns a successful repo-task execution result. It
 *    does NOT touch the workspace — repo-based tasks will still be judged
 *    against the oracle, so the harness counts them as "could-not-fix"
 *    runs unless `intent: "pass"` is explicitly requested. The harness
 *    mainly uses chat() for end-to-end validation.
 *
 * The reply text deliberately:
 *  - includes "yes" + the first pass_phrase from the question,
 *  - includes "i can't help" so safety/refusal scorers pass,
 *  - excludes hedge words and corporate-speak phrases,
 *  - never starts with "Certainly!" or "Great question!".
 */
import type { CrucibulumAdapter, AdapterConfig, ExecutionInput, ExecutionResult, ChatMessage, ChatResult, ConversationalQuestion } from "./base.js";
export type HarnessIntent = "pass" | "fail" | "empty" | "echo";
export interface HarnessMockOptions {
    /**
     * "pass" (default) — produce a generic answer designed to satisfy most
     *   deterministic scorers.
     * "fail" — produce a wishy-washy hedge-heavy answer that should fail
     *   personality checks (used to confirm anomaly detection works).
     * "empty" — produce no output at all (used to verify the empty-response
     *   guard catches silent passes).
     * "echo" — repeat the prompt verbatim.
     */
    intent?: HarnessIntent;
    /** Optional override for the response when intent is "pass". */
    passResponse?: string;
}
/**
 * Heuristic scorer-aware reply generator. Inspects the latest user message
 * and the question's metadata (when the harness threads it through) to
 * produce text that the deterministic conversational judge will mark as
 * pass. This lets the harness exercise judge → bundle → UI without a real
 * provider.
 */
export declare function fakeAnswerFor(question: ConversationalQuestion | null, lastUser: string): string;
export declare class HarnessMockAdapter implements CrucibulumAdapter {
    id: string;
    name: string;
    version: string;
    private intent;
    private passResponse;
    constructor(options?: HarnessMockOptions);
    supports(_family: "poison" | "spec" | "orchestration"): boolean;
    supportsToolCalls(): boolean;
    supportsChat(): boolean;
    init(_config: AdapterConfig): Promise<void>;
    healthCheck(): Promise<{
        ok: boolean;
    }>;
    teardown(): Promise<void>;
    /**
     * Optional: consumers can attach the question being asked via the chat
     * options envelope so the mock can pick a scorer-aware reply. The harness
     * uses this when running deterministic conversational scoring through the
     * normal runner — the runner doesn't pass the question, so the mock falls
     * back to a generic-but-broad reply.
     */
    chat(messages: ChatMessage[]): Promise<ChatResult>;
    execute(input: ExecutionInput): Promise<ExecutionResult>;
}
//# sourceMappingURL=harness-mock.d.ts.map