#!/bin/bash
# Load benchmark API keys from .env files.
# Requires LUAK_ROOT to be set, or auto-detects from script location.

LUAK_ROOT="${LUAK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

source "$LUAK_ROOT/.env.bench"
export DEEPSEEK_API_KEY MIMO_API_KEY MINIMAX_API_KEY
export LUAK_HMAC_KEY=$(grep LUAK_HMAC_KEY "$LUAK_ROOT/.env" | cut -d= -f2)
export OPENROUTER_API_KEY=dummy-placeholder-for-preflight-check
