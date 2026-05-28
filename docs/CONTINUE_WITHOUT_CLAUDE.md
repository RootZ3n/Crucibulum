# Continue Without Claude — Luak

## What this repo does

Luak is the model evaluation harness. Runs structured tests against
LLM models, compares outputs, scores accuracy, generates reports.

## Common commands

```bash
npm run build     # tsc
npm run dev       # tsc --watch
# Tests use custom scripts in test/ directories
```

## Known issues
- No systemd unit (runs manually or via Symposium)
- 35 uncommitted files
- Port 18795

## Safe edit zones
- `docs/`, test directories, evaluation templates

## Dangerous edit zones
- `src/adapters/` — model provider adapters
- `src/engine/` — evaluation engine core

## Top 5 future tasks
1. Add systemd unit for luak
2. Commit or document 35 uncommitted files
3. Add startup health endpoint
4. Document evaluation template format
5. Add smoke test script
