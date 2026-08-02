#!/usr/bin/env bash
set -uo pipefail
cd /pehverse/repos/ecosystem/luak

# Load the real OpenRouter API key
export OPENROUTER_API_KEY=$(cat /tmp/or_key.txt)

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG="runs/benchmark-sessions/kimi-k3-${TIMESTAMP}.log"
RESULTS="runs/benchmark-sessions/kimi-k3-${TIMESTAMP}.csv"
mkdir -p runs/benchmark-sessions

echo "model,task,result,score,duration_s,retries" > "$RESULTS"

MODEL="moonshotai/kimi-k3"
ADAPTER="openrouter"
MAX_RETRIES=5
BASE_DELAY=20  # seconds between retries (generous — Kimi K3 has upstream 429 warnings)

TASKS=$(node dist/cli/main.js list tasks 2>/dev/null | grep "Loaded manifest:" | sed 's/.*Loaded manifest: //' | sed 's/ .*//')
TASK_COUNT=$(echo "$TASKS" | wc -l)

echo "=== Kimi K3 Full Benchmark ===" | tee "$LOG"
echo "Model: $MODEL" | tee -a "$LOG"
echo "Adapter: $ADAPTER" | tee -a "$LOG"
echo "Tasks: $TASK_COUNT" | tee -a "$LOG"
echo "Max retries: $MAX_RETRIES (base delay: ${BASE_DELAY}s, exponential backoff)" | tee -a "$LOG"
echo "NOTE: Kimi K3 upstream has 'frequent 429' warning — expect some rate-limit retries" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "===================================" | tee -a "$LOG"

PASS=0
FAIL=0
ERR=0
TASK_NUM=0

for TASK in $TASKS; do
    TASK_NUM=$((TASK_NUM + 1))
    RETRIES=0
    SUCCESS=0

    while [ $RETRIES -le $MAX_RETRIES ] && [ $SUCCESS -eq 0 ]; do
        START_TS=$(date +%s)

        if [ $RETRIES -eq 0 ]; then
            echo -n "[$TASK_NUM/$TASK_COUNT] $TASK ... " | tee -a "$LOG"
        else
            DELAY=$((BASE_DELAY * RETRIES))
            echo -n "  retry $RETRIES/$MAX_RETRIES (wait ${DELAY}s) ... " | tee -a "$LOG"
            sleep $DELAY
        fi

        [ $RETRIES -gt 0 ] && echo '{}' > state/circuit-breaker.json

        OUT=$(timeout 240 node dist/cli/main.js harness --adapter "$ADAPTER" --model "$MODEL" --task "$TASK" 2>&1)
        EXIT=$?
        DURATION=$(($(date +%s) - START_TS))
        SCORE=$(echo "$OUT" | grep -oP 'Score: \K\d+' | head -1)

        if echo "$OUT" | grep -q "429\|rate.limit\|temporarily\|Provider returned error\|capacity"; then
            if [ $RETRIES -lt $MAX_RETRIES ]; then
                RETRIES=$((RETRIES + 1))
                continue
            else
                R="ERROR"
                ERR=$((ERR+1))
                echo "ERROR (rate limited after $MAX_RETRIES retries, ${DURATION}s)" | tee -a "$LOG"
                echo "$MODEL,$TASK,$R,$SCORE,$DURATION,$RETRIES" >> "$RESULTS"
                break
            fi
        fi

        SUCCESS=1

        if [ $EXIT -ne 0 ]; then
            R="ERROR"
            ERR=$((ERR+1))
            echo "ERROR (${DURATION}s, exit=$EXIT)" | tee -a "$LOG"
        elif echo "$OUT" | grep -q "passed"; then
            R="PASS"
            PASS=$((PASS+1))
            echo "PASS (score=$SCORE, ${DURATION}s)" | tee -a "$LOG"
        else
            R="FAIL"
            FAIL=$((FAIL+1))
            echo "FAIL (score=$SCORE, ${DURATION}s)" | tee -a "$LOG"
        fi

        echo "$MODEL,$TASK,$R,$SCORE,$DURATION,$RETRIES" >> "$RESULTS"
    done

    sleep 3
done

echo "" | tee -a "$LOG"
echo "===================================" | tee -a "$LOG"
echo "=== RESULTS SUMMARY ===" | tee -a "$LOG"
echo "Pass: $PASS / $TASK_COUNT" | tee -a "$LOG"
echo "Fail: $FAIL" | tee -a "$LOG"
echo "Error: $ERR" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"
echo "Log: $LOG" | tee -a "$LOG"
echo "CSV: $RESULTS" | tee -a "$LOG"
