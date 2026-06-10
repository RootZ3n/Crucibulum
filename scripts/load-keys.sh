#!/bin/bash
source /pehverse/repos/luak/.env.bench
export DEEPSEEK_API_KEY MIMO_API_KEY MINIMAX_API_KEY
export LUAK_HMAC_KEY=$(grep LUAK_HMAC_KEY /pehverse/repos/luak/.env | cut -d= -f2)
export OPENROUTER_API_KEY=dummy-placeholder-for-preflight-check
