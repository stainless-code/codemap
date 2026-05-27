---
"@stainless-code/codemap": patch
---

MCP session lifecycle hygiene: stdio disconnect detection (stdin EOF, stdout EPIPE, parent-PID poll) with graceful watcher shutdown on client exit; HTTP `serve --watch` refcount-gates the watcher per request (5s release grace, `/health` excluded). No MCP idle shutdown.
