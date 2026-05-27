---
"@stainless-code/codemap": patch
---

`agents init --mcp` writes PM-aware MCP spawn commands (e.g. `npx codemap`, `pnpm exec codemap`, `yarn exec codemap`, `bunx codemap`, or dlx `@stainless-code/codemap@latest`) instead of assuming global `codemap` on PATH.
