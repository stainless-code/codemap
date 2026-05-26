#!/usr/bin/env bash
# Agent eval harness — local A/B probe run (dev/CI only, not shipped in npm).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

OUT="${AGENT_EVAL_OUTPUT:-$REPO_ROOT/.agent-eval/comparison.json}"
RUNS="${AGENT_EVAL_RUNS:-1}"
FIXTURE_ROOT="${AGENT_EVAL_FIXTURE_ROOT:-$REPO_ROOT/fixtures/minimal}"
PROBES="${AGENT_EVAL_PROBES:-$SCRIPT_DIR/scenarios.json}"
SCENARIOS="${AGENT_EVAL_SCENARIOS:-$REPO_ROOT/fixtures/golden/scenarios.json}"

INDEX_DB="$FIXTURE_ROOT/.codemap/index.db"
SKIP_ARGS=()
if [[ -f "$INDEX_DB" ]]; then
  SKIP_ARGS=(--skip-index)
fi

echo "=== agent-eval: probe arms (runs=$RUNS) ==="
bun "$SCRIPT_DIR/run-probes.ts" \
  --output "$OUT" \
  --runs "$RUNS" \
  --fixture-root "$FIXTURE_ROOT" \
  --scenarios "$SCENARIOS" \
  --probes "$PROBES" \
  "${SKIP_ARGS[@]}"

if [[ -n "${AGENT_EVAL_LOG:-}" ]]; then
  echo "=== agent-eval: parse agent log $AGENT_EVAL_LOG ==="
  bun "$SCRIPT_DIR/print-log-metrics.ts" "$AGENT_EVAL_LOG"
fi

echo "Wrote $OUT"
