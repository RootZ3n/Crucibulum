# Roleplay Phase 5 — candidate route inventory

| Candidate | Tier | Provider/Adapter | Text? | Roleplay? | Family vs mimo? | Verdict |
|---|---|---|:--:|:--:|---|---|
| `openrouter / xiaomi/mimo-v2.5-pro` | RELEASE_CERTIFIED | OpenRouter | ✓ | ✓ | **Same** (Mimo) | Rejected — same model family as Phase-1 route, less comparison signal. |
| `openrouter / xiaomi/mimo-v2.5` | PROVIDER_TESTED | OpenRouter | ✓ | ✓ | **Same** (Mimo) | Rejected — same family. |
| `openrouter / xiaomi/mimo-v2-omni` | PROVIDER_TESTED | OpenRouter | ✓ | ✓ | **Same** (Mimo) | Rejected — same family (also primary Vision route; would conflate signals). |
| `openrouter / deepseek/deepseek-v4-pro` | PROVIDER_TESTED | OpenRouter | ✓ | ✓ | Different (DeepSeek) | Candidate. Pro tier higher cost; one historical transient FAIL_PROVIDER on personality logged in registry note. |
| **`openrouter / deepseek/deepseek-v4-flash`** | **PROVIDER_TESTED** | **OpenRouter** | **✓** | **✓** | **Different (DeepSeek)** | **Selected.** Different family from mimo (meaningful comparison), PROVIDER_TESTED text path, "flash" tier (cheapest in DeepSeek family), same provider (OpenRouter) as Phase-1 so transport surface stays apples-to-apples. |
| `ollama / qwen3.5:9b` | RELEASE_CERTIFIED | Ollama (local) | ✓ | ✓ | Different (Qwen) | Rejected — requires local Ollama runtime; the Phase-5 spec asks for an "already configured/provider-tested" cloud route comparable to Phase 1. |
| `openai / gpt-5.4-mini` | EXPERIMENTAL | OpenAI direct | ✓ | (defaults true) | Different (GPT-5) | Rejected for this phase — Phase 9 Vision added the entry with `supportsRoleplay` only via capabilityDefaults, never live-validated on Roleplay; Phase 5's "provider-tested text route" criterion fits DeepSeek-Flash better. Candidate for a future Phase. |

## Selected route

**`openrouter / deepseek/deepseek-v4-flash`** (exact id confirmed in
`MODEL_CERTIFICATION.models` at `ui/index.html:121`).

Reasons:
1. **PROVIDER_TESTED** tier — proven text path on the same
   OpenRouter adapter as the Phase-1 route, so the comparison
   isolates model-family differences from transport/adapter noise.
2. **Different model family** (DeepSeek vs Xiaomi/Mimo) — Phase 5's
   purpose is to surface model-behavioural differences, which
   requires a genuinely different family. Other Mimo variants
   (v2.5, v2.5-pro, v2-omni) would mostly re-test the same
   Mimo behaviour.
3. **Lowest-cost DeepSeek tier** ("flash") — keeps the smoke
   well inside the $1.00 cap.
4. **OpenRouter** — matches Phase-1's provider, so no new
   provider/adapter risk introduced by this comparison phase.
5. **`supportsRoleplay: true`** declared in the registry — runner
   will not silently skip with `SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE`.

The exact model id `deepseek/deepseek-v4-flash` is taken from the
existing registry — not guessed.
