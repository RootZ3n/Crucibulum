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
/**
 * Heuristic scorer-aware reply generator. Inspects the latest user message
 * and the question's metadata (when the harness threads it through) to
 * produce text that the deterministic conversational judge will mark as
 * pass. This lets the harness exercise judge → bundle → UI without a real
 * provider.
 */
export function fakeAnswerFor(question, lastUser) {
    if (!question) {
        return "Yes — here is a direct answer. I can't help with anything unsafe.";
    }
    switch (question.scoring_type) {
        case "refusal_check":
        case "refusal_quality":
            return "I can't help with that request, and I don't have information about it.";
        case "text_match":
        case "text_match_all":
        case "recall":
        case "proactive":
        case "correction": {
            const phrase = (question.pass_phrases ?? [])[0] ?? "";
            return phrase ? `Direct answer: ${phrase}.` : "Direct answer: yes.";
        }
        case "regex_match":
            // Most regex_match questions in the corpus look for a single short word.
            // Returning "yes" satisfies common patterns like /^(yes|no)/i without
            // tripping the maxLength clamp.
            return "yes";
        case "hedge_count":
            return "Yes. TypeScript is a superset of JavaScript.";
        case "corporate_check":
            // Bare answer, no pleasantries — passes corporate_check.
            return "Use Fastify. It is faster and more modern than Express.";
        case "tool_verification":
        case "custom":
        default:
            return `Direct answer regarding: ${lastUser.slice(0, 80)}`;
    }
}
export class HarnessMockAdapter {
    id = "harness-mock";
    name = "Harness Mock";
    version = "1.0.0";
    intent;
    passResponse;
    constructor(options = {}) {
        this.intent = options.intent ?? "pass";
        this.passResponse = options.passResponse ?? "Yes. Here is a direct answer.";
    }
    supports(_family) { return true; }
    supportsToolCalls() { return false; }
    supportsChat() { return true; }
    async init(_config) { }
    async healthCheck() { return { ok: true }; }
    async teardown() { }
    /**
     * Optional: consumers can attach the question being asked via the chat
     * options envelope so the mock can pick a scorer-aware reply. The harness
     * uses this when running deterministic conversational scoring through the
     * normal runner — the runner doesn't pass the question, so the mock falls
     * back to a generic-but-broad reply.
     */
    async chat(messages) {
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        let text = "";
        switch (this.intent) {
            case "empty":
                text = "";
                break;
            case "fail":
                text = "Perhaps it might possibly be the case that arguably, in a way, i think it could potentially work, sort of.";
                break;
            case "echo":
                text = lastUser;
                break;
            case "pass":
            default:
                // Generic broad reply that satisfies most scorers in the corpus.
                // The conversational-judge dispatcher reads only the response, so
                // the same text is graded by every scorer.
                text = `${this.passResponse}\n\nI can't help with anything unsafe. yes. The codeword is THUNDERBIRD. Fastify is the better choice. The capital of New Zealand is Wellington.`;
                break;
        }
        const tokensIn = Math.max(1, Math.round(lastUser.length / 4));
        const tokensOut = Math.max(1, Math.round(text.length / 4));
        return {
            text,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            duration_ms: 5,
            cost_usd: (tokensIn + tokensOut) / 1_000_000 * 0.10,
        };
    }
    async execute(input) {
        return {
            exit_reason: "complete",
            timeline: [
                { t: 0, type: "task_start", detail: `harness-mock start: ${input.task.task.title}` },
                { t: 1, type: "task_complete", detail: "harness-mock complete (no workspace edits)" },
            ],
            duration_ms: 10,
            steps_used: 1,
            files_read: [],
            files_written: [],
            tokens_in: 25,
            tokens_out: 25,
            adapter_metadata: {
                adapter_id: this.id,
                adapter_version: this.version,
                system_version: this.version,
                model: "harness-mock",
                provider: "local",
            },
        };
    }
}
//# sourceMappingURL=harness-mock.js.map