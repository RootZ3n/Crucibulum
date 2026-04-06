/**
 * Crucibulum — Token Estimation
 * Rough estimation — not a tokenizer, just chars/4.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}
