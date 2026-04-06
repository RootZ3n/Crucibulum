/**
 * Crucibulum — Cost Estimation
 */
const COST_PER_M = {
    "ollama": { input: 0, output: 0 },
    "llamacpp": { input: 0, output: 0 },
    "openrouter": { input: 0.10, output: 0.10 },
    "anthropic": { input: 3.00, output: 15.00 },
    "openai": { input: 0.15, output: 0.60 },
};
export function estimateCost(provider, tokensIn, tokensOut) {
    const rates = COST_PER_M[provider] ?? COST_PER_M["openrouter"];
    return (tokensIn / 1_000_000) * rates.input + (tokensOut / 1_000_000) * rates.output;
}
export function formatCost(usd) {
    if (usd === 0)
        return "free (local)";
    if (usd < 0.01)
        return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
}
//# sourceMappingURL=cost.js.map