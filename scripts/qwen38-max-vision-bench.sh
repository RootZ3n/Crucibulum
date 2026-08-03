#!/usr/bin/env bash
set -uo pipefail
cd /pehverse/repos/ecosystem/luak

# Qwen3.8 Max VISION suite — the 15 vision tasks skipped by the main run.
# The CLI now passes capabilities from registry tags (vision tag), so the
# preflight gate lets vision tasks through. OpenRouter forwards image parts.

export OPENROUTER_API_KEY=$(cat /tmp/or_key.txt)

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG="runs/benchmark-sessions/qwen38-max-vision-${TIMESTAMP}.log"
RESULTS="runs/benchmark-sessions/qwen38-max-vision-${TIMESTAMP}.csv"
mkdir -p runs/benchmark-sessions

echo "model,task,result,score,duration_s,retries" > "$RESULTS"

MODEL="qwen/qwen3.8-max"
ADAPTER="openrouter"
MAX_RETRIES=5
BASE_DELAY=15

TASKS=$(node dist/cli/main.js list tasks 2>/dev/null | grep "Loaded manifest:" | sed 's/.*Loaded manifest: //' | sed 's/ .*//' | grep "^vision-")
TASK_COUNT=$(echo "$TASKS" | wc -l)

echo "=== Qwen3.8 Max VISION Suite ===" | tee "$LOG"
echo "Model: $MODEL"
echo "Vision tasks: $TASK_COUNT"
echo "Started: $(date)"
echo "===================================" | tee -a "$LOG"

PASS=0; FAIL=0; ERR=0; TASK_NUM=0

for TASK in $TASKS; do
    TASK_NUM=$((TASK_NUM + 1))
    RETRIES=0; SUCCESS=0
    while [ $RETRIES -le $MAX_RETRIES ] && [ $SUCCESS -eq 0 ]; do
        START_TS=$(date +%s)
        if [ $RETRIES -eq 0 ]; then
            echo -n "[$TASK_NUM/$TASK_COUNT] $TASK ... " | tee -a "$LOG"
        else
            DELAY=$((BASE_DELAY * RETRIES))
            echo -n "  retry $RETRIES (wait ${DELAY}s) ... " | tee -a "$LOG"
            sleep $DELAY
        fi
        [ $RETRIES -gt 0 ] && echo '{}' > state/circuit-breaker.json
        OUT=$(timeout 180 node dist/cli/main.js harness --adapter "$ADAPTER" --model "$MODEL" --task "$TASK" 2>&1)
        EXIT=$?
        DURATION=$(($(date +%s) - START_TS))
        SCORE=$(echo "$OUT" | grep -oP 'Score: \K\d+' | head -1)
        if echo "$OUT" | grep -q "429\|rate.limit\|temporarily\|Provider returned error\|capacity"; then
            RETRIES=$((RETRIES + 1)); echo "rate-limited, retrying" | tee -a "$LOG"; continue
        fi
        SUCCESS=1
        if [ $EXIT -ne 0 ]; then R="ERROR"; ERR=$((ERR+1))
        elif echo "$OUT" | grep -q "passed / 0 failed"; then R="PASS"; PASS=$((PASS+1))
        else R="FAIL"; FAIL=$((FAIL+1)); fi
        echo "$MODEL,$TASK,$R,$SCORE,$DURATION,$RETRIES" >> "$RESULTS"
        echo "$R (score=$SCORE, ${DURATION}s)" | tee -a "$LOG"
    done
    if [ $SUCCESS -eq 0 ]; then
        echo "$MODEL,$TASK,ERROR,0,$DURATION,$RETRIES" >> "$RESULTS"
        echo "ERROR after retries" | tee -a "$LOG"; ERR=$((ERR+1))
    fi
    sleep 2
done

echo "===================================" | tee -a "$LOG"
echo "RESULTS: PASS=$PASS FAIL=$FAIL ERROR=$ERR (of $TASK_COUNT)" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"
