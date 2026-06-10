#!/usr/bin/env bash
# Luak Benchmark Runner — run all tasks against specified models
# Usage: ./scripts/run-benchmarks.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# Extract API keys from ~/bok
DEEPSEEK_API_KEY=$(sed -n '14p' ~/bok | grep -oP 'sk-[a-zA-Z0-9]+' | head -1)
MIMO_API_KEY=$(sed -n '3p' ~/bok | grep -oP 'sk-[a-zA-Z0-9]+' | head -1)
MINIMAX_API_KEY=$(sed -n '18p' ~/bok | grep -oP 'sk-[a-zA-Z0-9_-]+' | tail -1)
LUAK_HMAC_KEY=$(grep LUAK_HMAC_KEY .env | cut -d= -f2)

export DEEPSEEK_API_KEY MIMO_API_KEY MINIMAX_API_KEY LUAK_HMAC_KEY

# Models to benchmark
declare -A MODELS=(
  ["deepseek-v4-flash"]="openrouter"
  ["deepseek-v4-pro"]="openrouter"
  ["mimo-v2.5"]="openrouter"
  ["mimo-v2.5-pro"]="openrouter"
  ["MiniMax-M3"]="minimax"
)

LOG_DIR="runs/benchmark-sessions"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/benchmark-${TIMESTAMP}.log"

echo "=== Luak Benchmark Session ===" | tee "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Models: ${!MODELS[*]}" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_ERROR=0
declare -A MODEL_PASS MODEL_FAIL MODEL_ERROR

for MODEL in "${!MODELS[@]}"; do
  ADAPTER="${MODELS[$MODEL]}"
  MODEL_PASS[$MODEL]=0
  MODEL_FAIL[$MODEL]=0
  MODEL_ERROR[$MODEL]=0
  
  echo "========================================" | tee -a "$LOG_FILE"
  echo "MODEL: $MODEL (adapter: $ADAPTER)" | tee -a "$LOG_FILE"
  echo "========================================" | tee -a "$LOG_FILE"
  
  # Get all task IDs
  TASKS=$(node dist/cli/main.js list tasks 2>/dev/null | grep "Loaded manifest" | sed 's/.*Loaded manifest: //' | sed 's/ .*//')
  TASK_COUNT=$(echo "$TASKS" | wc -l)
  TASK_NUM=0
  
  for TASK in $TASKS; do
    TASK_NUM=$((TASK_NUM + 1))
    echo "[$TASK_NUM/$TASK_COUNT] $MODEL × $TASK ..." | tee -a "$LOG_FILE"
    
    RESULT_FILE=$(mktemp)
    if timeout 180 node dist/cli/main.js harness \
      --adapter "$ADAPTER" \
      --model "$MODEL" \
      --task "$TASK" \
      > "$RESULT_FILE" 2>&1; then
      
      # Extract pass/fail from output
      if grep -q "passed / 0 failed" "$RESULT_FILE"; then
        SCORE=$(grep -oP '\d+%' "$RESULT_FILE" | head -1)
        echo "  ✅ PASS ($SCORE)" | tee -a "$LOG_FILE"
        MODEL_PASS[$MODEL]=$((${MODEL_PASS[$MODEL]} + 1))
        TOTAL_PASS=$((TOTAL_PASS + 1))
      elif grep -q "0 passed" "$RESULT_FILE"; then
        SCORE=$(grep -oP '\d+%' "$RESULT_FILE" | head -1)
        echo "  ❌ FAIL ($SCORE)" | tee -a "$LOG_FILE"
        MODEL_FAIL[$MODEL]=$((${MODEL_FAIL[$MODEL]} + 1))
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
        # Log failure details
        grep -A2 "FAIL\|Pipeline breaks\|error" "$RESULT_FILE" >> "$LOG_FILE"
      else
        echo "  ⚠️  UNKNOWN" | tee -a "$LOG_FILE"
        cat "$RESULT_FILE" >> "$LOG_FILE"
      fi
    else
      echo "  💥 ERROR (timeout or crash)" | tee -a "$LOG_FILE"
      MODEL_ERROR[$MODEL]=$((${MODEL_ERROR[$MODEL]} + 1))
      TOTAL_ERROR=$((TOTAL_ERROR + 1))
      tail -5 "$RESULT_FILE" >> "$LOG_FILE"
    fi
    
    rm -f "$RESULT_FILE"
    echo "" >> "$LOG_FILE"
  done
done

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "FINAL RESULTS" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
for MODEL in "${!MODELS[@]}"; do
  echo "$MODEL: ${MODEL_PASS[$MODEL]} pass / ${MODEL_FAIL[$MODEL]} fail / ${MODEL_ERROR[$MODEL]} error" | tee -a "$LOG_FILE"
done
echo "" | tee -a "$LOG_FILE"
echo "TOTAL: $TOTAL_PASS pass / $TOTAL_FAIL fail / $TOTAL_ERROR error" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
