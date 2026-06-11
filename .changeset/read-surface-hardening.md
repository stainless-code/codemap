---
"@stainless-code/codemap": patch
---

Harden read surfaces: `codemap query --format …` blocks index mutations via the same read-only guard as `--json`; `codemap serve` requires `--token` when `--host` is not loopback; `codemap validate` (and MCP/HTTP `validate`) can return `rejected` rows with a `reason` when a path escapes the project root or resolves outside via symlink.
