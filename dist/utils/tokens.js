/**
 * Crucibulum — Token Estimation
 * Rough estimation — not a tokenizer, just chars/4.
 */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
export function estimateMessageTokens(messages) {
    return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}
//# sourceMappingURL=tokens.js.map