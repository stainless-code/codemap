#!/usr/bin/env bash
# Agent eval harness — local A/B probe or live MCP run (dev/CI only, not shipped in npm).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

OUT="${AGENT_EVAL_OUTPUT:-$REPO_ROOT/.agent-eval/comparison.json}"
RUNS="${AGENT_EVAL_RUNS:-1}"
MODE="${AGENT_EVAL_MODE:-probe}"
FIXTURE_ROOT="${AGENT_EVAL_FIXTURE_ROOT:-$REPO_ROOT/fixtures/minimal}"
PROBES="${AGENT_EVAL_PROBES:-$SCRIPT_DIR/scenarios.json}"
SCENARIOS="${AGENT_EVAL_SCENARIOS:-$REPO_ROOT/fixtures/golden/scenarios.json}"

INDEX_DB="$FIXTURE_ROOT/.codemap/index.db"
SKIP_ARGS=()
if [[ -f "$INDEX_DB" ]]; then
  SKIP_ARGS=(--skip-index)
fi

echo "=== agent-eval: ${MODE} arms (runs=$RUNS) ==="
set +e
bun "$SCRIPT_DIR/run-probes.ts" \
  --mode "$MODE" \
  --output "$OUT" \
  --runs "$RUNS" \
  --fixture-root "$FIXTURE_ROOT" \
  --scenarios "$SCENARIOS" \
  --probes "$PROBES" \
  "${SKIP_ARGS[@]}"
PROBE_EXIT=$?
set -e

if [[ "${AGENT_EVAL_PRINT_SUMMARY:-0}" == "1" && -f "$OUT" ]]; then
  bun "$SCRIPT_DIR/print-comparison-summary.ts" --input "$OUT"
fi

LOG_EXIT=0
if [[ "${AGENT_EVAL_CAPTURE:-}" == "1" ]]; then
  echo "=== agent-eval: capture synthetic log sessions ==="
  bun "$SCRIPT_DIR/capture-real-sessions.ts"
  export AGENT_EVAL_LOG_ON="${AGENT_EVAL_LOG_ON:-$REPO_ROOT/.agent-eval/sessions/real-mcp-on.json}"
  export AGENT_EVAL_LOG_OFF="${AGENT_EVAL_LOG_OFF:-$REPO_ROOT/.agent-eval/sessions/real-mcp-off.json}"
fi

if [[ -n "${AGENT_EVAL_LOG:-}" ]]; then
  echo "=== agent-eval: parse agent log $AGENT_EVAL_LOG ==="
  bun "$SCRIPT_DIR/print-log-metrics.ts" "$AGENT_EVAL_LOG"
fi

if [[ -n "${AGENT_EVAL_LOG_ON:-}" && -n "${AGENT_EVAL_LOG_OFF:-}" ]]; then
  LOG_OUT="${AGENT_EVAL_LOG_OUTPUT:-$REPO_ROOT/.agent-eval/log-comparison.json}"
  echo "=== agent-eval: compare live logs (orthogonal to AGENT_EVAL_MODE) ==="
  set +e
  bun "$SCRIPT_DIR/compare-live-logs.ts" \
    --mcp-on "$AGENT_EVAL_LOG_ON" \
    --mcp-off "$AGENT_EVAL_LOG_OFF" \
    --output "$LOG_OUT"
  LOG_EXIT=$?
  if [[ "$LOG_EXIT" -eq 0 ]]; then
    bun "$SCRIPT_DIR/print-comparison-summary.ts" --input "$LOG_OUT"
  fi
  set -e
fi

echo "Wrote $OUT"
if [[ "$PROBE_EXIT" -ne 0 ]]; then
  exit "$PROBE_EXIT"
fi
exit "$LOG_EXIT"
