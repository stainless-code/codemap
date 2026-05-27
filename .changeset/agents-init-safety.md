---
"@stainless-code/codemap": patch
---

`codemap agents init` is safer on re-run: IDE mirrors sync bundled template paths only; `--force` overwrites IDE mirrors only when they carry `codemap-init:managed` or match the legacy mirror heuristic (pre-marker bundled copies); invalid MCP JSON shapes are rejected instead of reset (even with `--force`).
