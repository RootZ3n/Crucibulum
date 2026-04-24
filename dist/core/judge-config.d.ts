/**
 * Crucible — Judge Model Configuration
 *
 * Central source of truth for the *model judge* — the optional second-opinion
 * / QC review model that scores subjective tasks (style, tone, character
 * consistency) on top of the deterministic judge. The deterministic judge is
 * still authoritative for repo-execution tasks; this only controls the
 * advisory model layer and any model-driven personality scoring.
 *
 * Defaults
 * --------
 * - provider: openrouter
 * - model:    xiaomi/mimo-v2-pro          (Xiaomi MiMo V2 Pro — closest
 *             registered OpenRouter id for the "MiMo V2.5 Pro" line)
 * - api key:  process.env.OPENROUTER_API_KEY
 *
 * Override
 * --------
 * Operators can override either field with environment variables:
 *
 *   CRUCIBLE_JUDGE_PROVIDER   provider id (e.g. "anthropic" or "ollama")
 *   CRUCIBLE_JUDGE_MODEL      OpenRouter / provider model id
 *
 * (For backwards compatibility the older OPENROUTER_JUDGE_MODEL var is
 * also honoured.)
 *
 * Fallback
 * --------
 * If the configured provider is offline or rejects the call, the run
 * proceeds with only the deterministic judge — model-judge results are
 * recorded as "skipped" with a reason. We never silently downgrade to a
 * different model: an operator who configured MiMo V2.5 Pro should not get
 * accidentally graded by Opus.
 */
export interface JudgeModelConfig {
    /** Provider id (matches adapter ids in adapters/registry.ts). */
    provider: string;
    /** Provider-specific model identifier. */
    model: string;
    /** Source of the configured value, useful for logs and the `/api/judge` doc payload. */
    source: "default" | "env" | "explicit";
}
export declare function getDefaultJudgeProvider(): string;
export declare function getDefaultJudgeModel(): string;
export declare function resolveJudgeConfig(explicit?: {
    provider?: string | undefined;
    model?: string | undefined;
}): JudgeModelConfig;
/**
 * Default model judge enrichment for the bundle's judge_usage field when no
 * model judge has been invoked. The provider/model fields are still empty —
 * meaning "deterministic only" — but downstream summaries can call this to
 * advertise what *would* run if a model judge were enabled.
 */
export declare function describeDefaultJudge(): {
    provider: string;
    model: string;
    api_key_env: string;
    fallback: string;
};
export declare const JUDGE_CONFIG_CONSTANTS: {
    readonly DEFAULT_JUDGE_PROVIDER: "openrouter";
    readonly DEFAULT_JUDGE_MODEL: "xiaomi/mimo-v2-pro";
};
//# sourceMappingURL=judge-config.d.ts.map