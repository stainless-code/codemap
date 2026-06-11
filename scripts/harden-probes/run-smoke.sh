#!/usr/bin/env bash
# Run mechanical harden-probe checks (schema + pre-fix acceptance fails).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "== harden-probes: validate fixtures =="
bun test scripts/harden-probes/validate-fixtures.test.mjs

echo ""
echo "== harden-probes: pre-fix acceptance (expect fail) =="
PROBE="$ROOT/fixtures/harden-probes/missing-test"
if git -C "$PROBE" diff --quiet src/formatWidget.test.ts 2>/dev/null || [[ ! -f "$PROBE/src/formatWidget.test.ts" ]]; then
  # Ensure probe is in broken state (no test file)
  rm -f "$PROBE/src/formatWidget.test.ts"
fi
if bash "$PROBE/acceptance.sh" 2>/dev/null; then
  echo "FAIL: acceptance should fail before harden (missing test)" >&2
  exit 1
fi
echo "ok: acceptance correctly fails pre-harden"

echo ""
echo "== harden-probes: score sample findings =="
SAMPLE="$ROOT/.agent-eval/harden-missing-test-findings.json"
mkdir -p "$(dirname "$SAMPLE")"
cat > "$SAMPLE" <<'EOF'
[
  {
    "finding": "New export formatWidget has no unit test covering empty and non-empty names",
    "severity": "major",
    "file": "src/formatWidget.ts",
    "line": 2,
    "confidence": "high",
    "effort": "S",
    "fixable_in_bounds": true,
    "production_bar": "Tests"
  }
]
EOF
bun scripts/harden-probes/score-probe.mjs "$PROBE" "$SAMPLE"

echo ""
echo "Manual: cd fixtures/harden-probes/missing-test && /harden-pr lite → bash acceptance.sh"
