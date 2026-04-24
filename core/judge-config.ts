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

const DEFAULT_JUDGE_PROVIDER = "openrouter";
const DEFAULT_JUDGE_MODEL = "xiaomi/mimo-v2-pro";

export interface JudgeModelConfig {
  /** Provider id (matches adapter ids in adapters/registry.ts). */
  provider: string;
  /** Provider-specific model identifier. */
  model: string;
  /** Source of the configured value, useful for logs and the `/api/judge` doc payload. */
  source: "default" | "env" | "explicit";
}

export function getDefaultJudgeProvider(): string {
  return process.env["CRUCIBLE_JUDGE_PROVIDER"]?.trim() || DEFAULT_JUDGE_PROVIDER;
}

export function getDefaultJudgeModel(): string {
  return (
    process.env["CRUCIBLE_JUDGE_MODEL"]?.trim()
    || process.env["OPENROUTER_JUDGE_MODEL"]?.trim()
    || DEFAULT_JUDGE_MODEL
  );
}

export function resolveJudgeConfig(explicit?: { provider?: string | undefined; model?: string | undefined }): JudgeModelConfig {
  const explicitProvider = explicit?.provider?.trim();
  const explicitModel = explicit?.model?.trim();
  if (explicitProvider && explicitModel) {
    return { provider: explicitProvider, model: explicitModel, source: "explicit" };
  }
  const envProvider = process.env["CRUCIBLE_JUDGE_PROVIDER"]?.trim();
  const envModel = process.env["CRUCIBLE_JUDGE_MODEL"]?.trim() || process.env["OPENROUTER_JUDGE_MODEL"]?.trim();
  if (envProvider || envModel) {
    return {
      provider: explicitProvider || envProvider || DEFAULT_JUDGE_PROVIDER,
      model: explicitModel || envModel || DEFAULT_JUDGE_MODEL,
      source: "env",
    };
  }
  return { provider: DEFAULT_JUDGE_PROVIDER, model: DEFAULT_JUDGE_MODEL, source: "default" };
}

/**
 * Default model judge enrichment for the bundle's judge_usage field when no
 * model judge has been invoked. The provider/model fields are still empty —
 * meaning "deterministic only" — but downstream summaries can call this to
 * advertise what *would* run if a model judge were enabled.
 */
export function describeDefaultJudge(): { provider: string; model: string; api_key_env: string; fallback: string } {
  const cfg = resolveJudgeConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    api_key_env: cfg.provider === "openrouter" ? "OPENROUTER_API_KEY" : `${cfg.provider.toUpperCase()}_API_KEY`,
    fallback: "When the configured judge provider is unreachable, only the deterministic scorer runs. Model-judge results are marked 'skipped'; the run is never silently re-routed to a different model.",
  };
}

export const JUDGE_CONFIG_CONSTANTS = {
  DEFAULT_JUDGE_PROVIDER,
  DEFAULT_JUDGE_MODEL,
} as const;
