---
"@stainless-code/codemap": patch
---

MCP `tools/list` and HTTP `GET /tools` expose advisory `readOnlyHint`, `destructiveHint`, and `idempotentHint` per tool so clients can gate auto-approval. Apply tools carry `destructiveHint`; read-only query tools carry `readOnlyHint`.
