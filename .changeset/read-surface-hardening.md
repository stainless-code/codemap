---
"@stainless-code/codemap": patch
---

Harden read surfaces: `codemap query --format …` blocks index mutations via the same read-only guard as `--json`; `codemap serve` requires `--token` when `--host` is not loopback (any `127.0.0.0/8` address counts as loopback, so `--token` stays optional on `127.0.0.2` and similar); `codemap validate` (and MCP/HTTP `validate`) can return `rejected` rows with a `reason` when a path escapes the project root, resolves outside via symlink, or is a broken symlink — output `path` keys are always project-relative POSIX paths.
