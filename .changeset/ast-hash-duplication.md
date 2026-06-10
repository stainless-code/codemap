---
"@stainless-code/codemap": minor
---

Add structural duplicate detection: `symbols.body_hash` at index time (canonical function body AST) and bundled `duplicates` recipe. Function-shaped symbols only; trivial one-line bodies skipped. Triage collisions with `snippet` — shared control-flow skeletons can false-positive.
