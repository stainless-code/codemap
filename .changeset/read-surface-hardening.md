---
"@stainless-code/codemap": patch
---

Harden read surfaces: `codemap query --format …` blocks index mutations via the same read-only guard as `--json`; `codemap serve` requires `--token` when `--host` is not loopback (any `127.0.0.0/8` address counts as loopback, so `--token` stays optional on `127.0.0.2` and similar); `codemap validate` (and MCP/HTTP `validate`) can return `rejected` rows with optional `reason` (`path escapes project root` | `path escapes via symlink` | `path resolves outside project root`) — output `path` keys are always project-relative POSIX paths.
