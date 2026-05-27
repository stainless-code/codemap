#!/usr/bin/env bash
# Resolve Action working-directory under GITHUB_WORKSPACE (mirrors action.yml detect-pm step).
set -euo pipefail
GITHUB_WORKSPACE="${1:?GITHUB_WORKSPACE required}"
WORK_DIR="${2:-}"
if [[ "$WORK_DIR" == *".."* ]]; then
  echo "::error::codemap action: working-directory must not contain .." >&2
  exit 1
fi
if [ -z "$WORK_DIR" ] || [ "$WORK_DIR" = "." ]; then
  echo "$GITHUB_WORKSPACE"
else
  echo "$GITHUB_WORKSPACE/$WORK_DIR"
fi
