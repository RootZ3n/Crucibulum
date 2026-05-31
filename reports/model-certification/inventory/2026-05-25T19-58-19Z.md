# Crucible — model certification inventory

- **Timestamp (UTC):** 2026-05-25T19-58-19Z
- **Operator:** Zen
- **Source:** `ui/index.html` (`DEFAULT_MODEL_GROUPS`, `RELEASE_CERTIFICATION`) + `.env` + `curl http://localhost:11434/api/tags`

Status keys: `CERTIFIED_RELEASE_TARGET` · `PROVIDER_TESTED` · `UNCERTIFIED_VISIBLE` · `BLOCKED_CONFIG` · `OFFLINE` · `UNKNOWN`

## Provider: Ollama (local)

| Adapter | Model ID | Display name | Visible in UI | Local Ollama pull | Local/Cloud | Current status | Capability profile |
|---|---|---|---|---|---|---|---|
| ollama | `gemma4:e4b` | gemma4:e4b | ✓ | ✓ | local | UNCERTIFIED_VISIBLE | text, code |
| ollama | `qwen3.5:9b` | qwen3.5:9b | ✓ | ✓ | local | **CERTIFIED_RELEASE_TARGET** | text, code, tool, repo |
| ollama | `qwen3.5:4b` | qwen3.5:4b | ✓ | ✗ (not pulled — only 0.8b and 9b available) | local | BLOCKED_CONFIG | text, code |
| ollama | `qwen2.5:7b-instruct` | qwen2.5:7b-instruct | ✓ | ✓ | local | UNCERTIFIED_VISIBLE | text, code, tool |

**Other local models present but not in DEFAULT_MODEL_GROUPS** (available for future certification):
`qwen3.6:35b`, `qwen3.5:0.8b`, `qwen3.6:latest`, `laguna-xs.2:latest`,
`granite4.1:30b`, `ibm/granite4.1:8b`, `all-minilm:latest`, `gemma4:26b`,
`qwen3-vl:4b`, `qwen35-9b-peh:latest`, `qwen3-coder:30b`,
`qwen2.5:14b-instruct`.

## Provider: OpenRouter (cloud)

API key: `OPENROUTER_API_KEY` set.

| Adapter | Model ID | Display name | Visible | Status | Capability |
|---|---|---|---|---|---|
| openrouter | `xiaomi/mimo-v2.5` | MiMo v2.5 | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `xiaomi/mimo-v2.5-pro` | MiMo v2.5 Pro | ✓ | **CERTIFIED_RELEASE_TARGET** | text |
| openrouter | `xiaomi/mimo-v2-flash` | MiMo Flash | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `xiaomi/mimo-v2-omni` | MiMo Omni | ✓ | UNCERTIFIED_VISIBLE | text, vision |
| openrouter | `moonshotai/kimi-k2.6` | Kimi K2.6 | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `qwen/qwen3.6-plus` | Qwen 3.6 Plus | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `z-ai/glm-5.1` | GLM 5.1 | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `x-ai/grok-4.3` | Grok 4.3 | ✓ | UNCERTIFIED_VISIBLE | text |
| openrouter | `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | ✓ | **CERTIFIED_RELEASE_TARGET** | text, code |
| openrouter | `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | ✓ | UNCERTIFIED_VISIBLE | text |

## Provider: ModelStudio / Dashscope (cloud)

API key: `DASHSCOPE_API_KEY` set. Adapter: `peh`.

| Adapter | Model ID | Visible | Status |
|---|---|---|---|
| peh | `qwen3.6-plus` | ✓ | UNCERTIFIED_VISIBLE |
| peh | `glm-4` | ✓ | UNCERTIFIED_VISIBLE |

## Provider: ZAI (cloud)

API key: `ZAI_API_KEY` (not confirmed set in .env shown). Adapter: `zai`.

| Adapter | Model ID | Visible | Status |
|---|---|---|---|
| zai | `glm-5.1` | ✓ | UNKNOWN |
| zai | `glm-4-plus` | ✓ | UNKNOWN |
| zai | `glm-z1-flash` | ✓ | UNKNOWN |

## Provider: Anthropic (cloud)

API key: `ANTHROPIC_API_KEY` set.

| Adapter | Model ID | Visible | Status |
|---|---|---|---|
| anthropic | `claude-opus-4-6` | ✓ | UNCERTIFIED_VISIBLE |
| anthropic | `claude-sonnet-4-6` | ✓ | UNCERTIFIED_VISIBLE |

## Provider: OpenAI (cloud)

API key: `OPENAI_API_KEY` set.

| Adapter | Model ID | Visible | Status |
|---|---|---|---|
| openai | `gpt-5.4` | ✓ | UNCERTIFIED_VISIBLE |
| openai | `gpt-5.4-mini` | ✓ | UNCERTIFIED_VISIBLE |
| openai | `gpt-5.4-nano` | ✓ | UNCERTIFIED_VISIBLE |

## Provider: MiniMax (cloud, direct)

API key: `MINIMAX_API_KEY` set. Account-scoped provider.

| Adapter | Model ID | Visible | Status |
|---|---|---|---|
| minimax | `abab6.5s-chat` | ✓ | UNCERTIFIED_VISIBLE |
| minimax | `abab6.5g-chat` | ✓ | UNCERTIFIED_VISIBLE |
| minimax | `abab6.5-chat` | ✓ | UNCERTIFIED_VISIBLE |
| minimax | `abab5.5-chat` | ✓ | UNCERTIFIED_VISIBLE |
| minimax | `MiniMax-Text-01` | ✓ | UNCERTIFIED_VISIBLE |

## Inventory totals

- Total visible models: **28**
- Currently certified release targets: **3**
- Models blocked-config (not pulled / no key): **1** (qwen3.5:4b)
- Models requested for this certification campaign:
  - Local Ollama (free): gemma4:e4b, qwen3.5:9b (recert), qwen2.5:7b-instruct
  - OpenRouter (cloud, $0.50 cap each): all 6 operator-priority models
    (deepseek-v4-pro recert, deepseek-v4-flash, mimo-v2.5, mimo-v2.5-pro recert,
    mimo-v2-flash, mimo-v2-omni)

Stretch goal (not part of this run): Anthropic / OpenAI / MiniMax /
ModelStudio / ZAI direct providers — operator did not flag as priority.
