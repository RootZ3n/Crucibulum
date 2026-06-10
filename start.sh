#!/bin/bash
set -e

LUAK_DIR="${LUAK_DIR:-${CRUCIBLE_DIR:-/mnt/ai/crucible}}"
LUAK_PORT="${LUAK_PORT:-${CRUCIBLE_PORT:-18795}}"
GATEWAY_PORT="${GATEWAY_PORT:-18800}"

echo "=== Luak Launcher ==="

# ── Wait for gateway to be healthy ────────────────────────────────────────
echo "Waiting for gateway (port $GATEWAY_PORT)..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$GATEWAY_PORT/health" > /dev/null 2>&1; then
    echo "Gateway is healthy."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: Gateway not reachable at http://127.0.0.1:$GATEWAY_PORT/health after 30s."
    exit 1
  fi
  sleep 1
done

# ── Check if Luak server is already running ────────────────────────────
if curl -sf "http://127.0.0.1:$LUAK_PORT/api/health" > /dev/null 2>&1; then
  echo "Luak is already running on port $LUAK_PORT — skipping start."
else
  echo "Starting Luak server on port $LUAK_PORT..."

  # Load env vars so node can find API keys
  set -a
  source "$LUAK_DIR/.env" 2>/dev/null || true
  set +a

  # ── Ensure a bundle-signing HMAC key exists ───────────────────────────────
  # Without LUAK_HMAC_KEY the integrity model is inert: every bundle verifies to
  # "legacy_unverified" (content hash only, no secret) and forged bundles are
  # indistinguishable from legitimate ones. Generate one on first launch and
  # PERSIST it to .env — a fresh key each restart would invalidate the
  # signatures of every previously-stored bundle. (Fable 5 audit C2.)
  if [ -z "${LUAK_HMAC_KEY:-}" ] && [ -z "${CRUCIBLE_HMAC_KEY:-}" ]; then
    GENERATED_HMAC_KEY="$(openssl rand -hex 32)"
    export LUAK_HMAC_KEY="$GENERATED_HMAC_KEY"
    if [ -w "$LUAK_DIR/.env" ] || [ ! -e "$LUAK_DIR/.env" ]; then
      {
        echo ""
        echo "# Auto-generated bundle-signing key (LUAK HMAC). Keep this secret and stable."
        echo "LUAK_HMAC_KEY=$GENERATED_HMAC_KEY"
      } >> "$LUAK_DIR/.env"
      echo "Generated and persisted LUAK_HMAC_KEY to .env (bundle signing now active)."
    else
      echo "WARNING: LUAK_HMAC_KEY not set and .env is not writable — using an ephemeral key for this session only."
      echo "         Bundles signed this session will fail verification after restart. Set LUAK_HMAC_KEY in .env to persist."
    fi
  fi

  # Start the server in the background
  cd "$LUAK_DIR"
  node dist/server/api.js &
  SERVER_PID=$!
  echo "Luak server started (PID $SERVER_PID)."

  # Wait for it to come up
  for i in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:$LUAK_PORT/api/health" > /dev/null 2>&1; then
      echo "Luak is ready on port $LUAK_PORT."
      break
    fi
    if [ "$i" -eq 20 ]; then
      echo "ERROR: Luak server did not come up on port $LUAK_PORT."
      kill "$SERVER_PID" 2>/dev/null || true
      exit 1
    fi
    sleep 1
  done
fi

# ── Health check ────────────────────────────────────────────────────────────
HEALTH=$(curl -sf "http://127.0.0.1:$LUAK_PORT/api/health")
if [ $? -ne 0 ]; then
  echo "ERROR: Luak health check failed."
  exit 1
fi

echo ""
echo "=== Luak is running ==="
echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  Status : {d[\"status\"]}')" 2>/dev/null || echo "$HEALTH"
echo "  URL    : http://127.0.0.1:$LUAK_PORT/"