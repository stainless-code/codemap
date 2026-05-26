---
"@stainless-code/codemap": patch
---

Fix `codemap --full` (and other worker-pool parses) appearing to hang ~120s after stats print — clear parse timeout timers when workers respond instead of leaving orphaned `setTimeout` handles on the event loop.
