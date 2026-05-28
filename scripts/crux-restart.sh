#!/usr/bin/env bash
# crux-restart.sh — safe Luak restart with verification.
#
# Replaces the bare `sudo systemctl restart luak && echo "Luak
# restarted"` alias in ~/.bashrc. The old alias printed success
# whenever `systemctl restart` exited 0, even in failure modes the
# operator cared about:
#
#   - a non-systemd `npm run serve` process was holding port 18795,
#     so the new systemd-managed process couldn't bind and the same
#     stale PID kept serving;
#   - the systemd unit started a new process but it crashed before
#     binding the port;
#   - the new process bound the port but /api/health's `uptime`
#     hadn't reset — usually because the in-process uptime tracking
#     hadn't actually rolled.
#
# This script captures pre-restart PID + /api/health uptime, runs
# the restart, then polls up to ~10s for a new PID with a low
# uptime. Only prints "Luak restarted" when ALL three are true:
#
#   1. A process is bound on the port post-restart.
#   2. Its PID is different from the pre-restart PID.
#   3. /api/health uptime has dropped below 15s.
#
# Exit codes:
#   0  success (all three verifications passed)
#   2  systemctl restart returned non-zero
#   3  no process listening on the port after restart
#   4  PID did not change after restart (stale process)
#   5  /api/health uptime did not reset (likely stale-process or
#      same-process restart)
#
# Phase 16-B (2026-05-27) replaced the alias-bug with this script.

set -euo pipefail

PORT="${CRUX_RESTART_PORT:-18795}"
SERVICE="${CRUX_RESTART_SERVICE:-luak}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

pid_on_port() {
  # Print the listening PID on PORT, or empty string. ss output:
  #   LISTEN 0  511  0.0.0.0:18795  0.0.0.0:*  users:(("node",pid=12345,fd=21))
  ss -tlnp 2>/dev/null \
    | awk -v p=":${PORT}$" '$4 ~ p { print }' \
    | grep -oE 'pid=[0-9]+' \
    | head -1 \
    | cut -d= -f2
}

uptime_seconds() {
  curl -sfm 2 "${HEALTH_URL}" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("uptime",""))' 2>/dev/null \
    || echo ""
}

is_low_uptime() {
  # awk arithmetic: returns true if $1 (numeric) is < 15. Empty or
  # non-numeric → false.
  awk -v u="$1" 'BEGIN { exit !(u + 0 < 15 && u != "") }'
}

pre_pid="$(pid_on_port || true)"
pre_uptime="$(uptime_seconds)"

echo "→ pre-restart on :${PORT}: pid=${pre_pid:-none} uptime=${pre_uptime:-?}s"

if ! sudo systemctl restart "${SERVICE}"; then
  echo "✗ systemctl restart ${SERVICE} returned non-zero — restart aborted, pre-existing process retained" >&2
  exit 2
fi

# Poll for the new process to bind + uptime to reset. Up to ~10s in
# 0.5s increments, with verification at each step.
post_pid=""
post_uptime=""
for _ in $(seq 1 20); do
  sleep 0.5
  post_pid="$(pid_on_port || true)"
  post_uptime="$(uptime_seconds)"
  if [ -n "${post_pid}" ] \
     && [ "${post_pid}" != "${pre_pid:-}" ] \
     && is_low_uptime "${post_uptime}"; then
    break
  fi
done

echo "→ post-restart on :${PORT}: pid=${post_pid:-none} uptime=${post_uptime:-?}s"

if [ -z "${post_pid}" ]; then
  echo "✗ no process is listening on :${PORT} after restart — the unit failed to bind the port" >&2
  echo "  (something else may be holding the port — e.g. a manual 'npm run serve' or a stuck process)" >&2
  exit 3
fi
if [ "${post_pid}" = "${pre_pid:-}" ]; then
  echo "✗ PID did not change (still ${post_pid}) — systemctl reported success but a stale process is still serving" >&2
  echo "  (the systemd unit may not own this port; check with: ss -tlnp | grep :${PORT})" >&2
  exit 4
fi
if ! is_low_uptime "${post_uptime}"; then
  echo "✗ /api/health uptime did not reset (still ${post_uptime}s) — investigate stale-process or health-cache issue" >&2
  exit 5
fi

echo "✓ Luak restarted on :${PORT} (pid ${pre_pid:-?} → ${post_pid}; uptime ${pre_uptime:-?}s → ${post_uptime}s)"
