#!/usr/bin/env bash
# Full Luak Benchmark Suite — 5 models × all tasks
set -uo pipefail

cd /pehverse/repos/luak

# Source API keys from .env.bench (has correct MiMo key)
source scripts/load-keys.sh 2>/dev/null || true
echo '{}' > state/circuit-breaker.json

LOG_DIR="runs/benchmark-sessions"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG="$LOG_DIR/full-suite-${TIMESTAMP}.log"
RESULTS="$LOG_DIR/full-suite-${TIMESTAMP}.csv"

echo "model,task,result,score,duration_s,cost" > "$RESULTS"

# Models: adapter|model_id|display_name
# DeepSeek + MiMo use openai-compatible adapter (no OpenRouter dependency)
# MiniMax has its own adapter
MODELS=(
  "openai-compatible|deepseek-v4-flash|DeepSeek V4 Flash"
  "openai-compatible|deepseek-v4-pro|DeepSeek V4 Pro"
  "openai-compatible|mimo-v2.5|MiMo V2.5"
  "openai-compatible|mimo-v2.5-pro|MiMo V2.5 Pro"
  "minimax|MiniMax-M3|MiniMax M3"
)

# Get all tasks
TASKS=$(node dist/cli/main.js list tasks 2>/dev/null | grep "Loaded manifest" | sed 's/.*Loaded manifest: //' | sed 's/ .*//')
TASK_COUNT=$(echo "$TASKS" | wc -l)

echo "=== Luak Full Benchmark Suite ===" | tee "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "Models: ${#MODELS[@]}, Tasks: $TASK_COUNT" | tee -a "$LOG"
echo "Log: $LOG" | tee -a "$LOG"
echo "Results: $RESULTS" | tee -a "$LOG"
echo "" | tee -a "$LOG"

TOTAL=0
PASS=0
FAIL=0
ERROR=0

for MODEL_SPEC in "${MODELS[@]}"; do
  IFS='|' read -r ADAPTER MODEL DISPLAY <<< "$MODEL_SPEC"
  
  echo "========================================" | tee -a "$LOG"
  echo "$DISPLAY ($MODEL)" | tee -a "$LOG"
  echo "========================================" | tee -a "$LOG"
  
  M_PASS=0; M_FAIL=0; M_ERR=0
  TASK_NUM=0
  
  for TASK in $TASKS; do
    TASK_NUM=$((TASK_NUM + 1))
    TOTAL=$((TOTAL + 1))
    START_TS=$(date +%s)
    
    OUT=$(timeout 180 node dist/cli/main.js harness --adapter "$ADAPTER" --model "$MODEL" --task "$TASK" 2>&1)
    EXIT=$?
    END_TS=$(date +%s)
    DURATION=$((END_TS - START_TS))
    
    # Extract score and cost
    SCORE=$(echo "$OUT" | grep -oP 'Score: \K\d+' | head -1)
    COST=$(echo "$OUT" | grep -oP 'Model cost:.*?\$([0-9.]+)' | grep -oP '\$[0-9.]+' | head -1)
    [ -z "$COST" ] && COST="\$0"
    
    if [ $EXIT -ne 0 ]; then
      RESULT="ERROR"
      M_ERR=$((M_ERR + 1)); ERROR=$((ERROR + 1))
      echo "  [$TASK_NUM/$TASK_COUNT] $TASK 💥 ERROR (${DURATION}s)" | tee -a "$LOG"
      echo "$OUT" | tail -3 >> "$LOG"
    elif echo "$OUT" | grep -q "passed / 0 failed"; then
      RESULT="PASS"
      M_PASS=$((M_PASS + 1)); PASS=$((PASS + 1))
      echo "  [$TASK_NUM/$TASK_COUNT] $TASK ✅ ${SCORE:-100}% (${DURATION}s, $COST)" | tee -a "$LOG"
    else
      RESULT="FAIL"
      M_FAIL=$((M_FAIL + 1)); FAIL=$((FAIL + 1))
      echo "  [$TASK_NUM/$TASK_COUNT] $TASK ❌ ${SCORE:-0}% (${DURATION}s, $COST)" | tee -a "$LOG"
      # Log failure details
      echo "$OUT" | grep -A1 "Pipeline breaks\|Outcomes:" >> "$LOG"
    fi
    
    echo "$MODEL,$TASK,$RESULT,$SCORE,$DURATION,$COST" >> "$RESULTS"
  done
  
  echo "" | tee -a "$LOG"
  echo "$DISPLAY: $M_PASS pass / $M_FAIL fail / $M_ERR error" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
done

echo "========================================" | tee -a "$LOG"
echo "FINAL: $TOTAL total — $PASS pass / $FAIL fail / $ERROR error" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"

# Also write a summary CSV
SUMMARY="$LOG_DIR/full-suite-${TIMESTAMP}-summary.csv"
echo "model,pass,fail,error,total,pass_rate" > "$SUMMARY"
for MODEL_SPEC in "${MODELS[@]}"; do
  IFS='|' read -r ADAPTER MODEL DISPLAY <<< "$MODEL_SPEC"
  M_PASS=$(grep "^$MODEL," "$RESULTS" | grep -c ",PASS,")
  M_FAIL=$(grep "^$MODEL," "$RESULTS" | grep -c ",FAIL,")
  M_ERR=$(grep "^$MODEL," "$RESULTS" | grep -c ",ERROR,")
  M_TOTAL=$((M_PASS + M_FAIL + M_ERR))
  if [ $M_TOTAL -gt 0 ]; then
    RATE=$(echo "scale=1; $M_PASS * 100 / $M_TOTAL" | bc)
  else
    RATE="0"
  fi
  echo "$DISPLAY,$M_PASS,$M_FAIL,$M_ERR,$M_TOTAL,${RATE}%" >> "$SUMMARY"
done

echo "" | tee -a "$LOG"
echo "Summary: $SUMMARY" | tee -a "$LOG"
cat "$SUMMARY" | tee -a "$LOG"
