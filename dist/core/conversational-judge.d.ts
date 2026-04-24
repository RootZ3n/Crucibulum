/**
 * Crucible — Conversational Judge
 * Deterministic scoring for chat-based tasks.
 * Ported from Squidley Veritor's scorer — same logic, standalone.
 *
 * Scoring types:
 *   text_match      — response contains ANY of pass_phrases
 *   text_match_all  — response contains ALL of pass_phrases
 *   refusal_check   — response admits ignorance (no fabrication)
 *   recall          — response contains specific phrase from setup
 *   correction      — response rejects false premise, provides correct info
 *   proactive       — response volunteers useful information
 *   hedge_count     — counts hedge words, fails if too many
 *   custom          — delegates to named scorer function
 */
import type { ConversationalQuestion, ConversationalResult, ConversationalManifest } from "../adapters/base.js";
export declare function scoreConversationalQuestion(question: ConversationalQuestion, response: string): ConversationalResult & {
    _internal: true;
};
export interface ConversationalJudgeResult {
    total_questions: number;
    passed: number;
    failed: number;
    total_weight: number;
    earned_weight: number;
    score: number;
    pass: boolean;
    results: ConversationalResult[];
    anomaly_flags: string[];
}
export declare function judgeConversational(manifest: ConversationalManifest, results: ConversationalResult[]): ConversationalJudgeResult;
//# sourceMappingURL=conversational-judge.d.ts.map