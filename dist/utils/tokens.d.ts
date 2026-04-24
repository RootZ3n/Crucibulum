/**
 * Crucible — Token Estimation
 * Rough estimation — not a tokenizer, just chars/4.
 */
export declare function estimateTokens(text: string): number;
export declare function estimateMessageTokens(messages: Array<{
    role: string;
    content: string;
}>): number;
//# sourceMappingURL=tokens.d.ts.map