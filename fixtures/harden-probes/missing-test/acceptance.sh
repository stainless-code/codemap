#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! compgen -G "src/**/*.test.ts" > /dev/null && [[ ! -f src/formatWidget.test.ts ]]; then
  echo "acceptance: missing test file for formatWidget" >&2
  exit 1
fi

if ! grep -rq "formatWidget" src/*.test.ts src/**/*.test.ts 2>/dev/null; then
  echo "acceptance: no test references formatWidget" >&2
  exit 1
fi

bun test src/

echo "acceptance: ok"
