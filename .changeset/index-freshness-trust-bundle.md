---
"@stainless-code/codemap": patch
---

Add `index_freshness` metadata on `context`, MCP tool responses, HTTP headers, and boot stderr warnings so agents can detect commit drift, pending watcher sync, and disk-ahead-of-index states before trusting structural queries.
