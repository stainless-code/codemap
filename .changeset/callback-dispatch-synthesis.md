---
"@stainless-code/codemap": minor
---

Add optional heuristic call edges (`calls.provenance`) for JSX parent→child composition. Schema rebuild to v37. Enable via `.codemap/config` `synthesis.heuristicCalls: true` (default off). Bundled recipe `calls-including-heuristic`; `call-path` excludes heuristics by default.
