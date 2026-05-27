---
"@stainless-code/codemap": patch
---

`codemap agents init` is safer on re-run: IDE mirrors sync bundled template paths only, `--force` overwrites mirror files only when they carry the `codemap-init:managed` marker, and invalid MCP JSON shapes are rejected instead of reset (even with `--force`).
