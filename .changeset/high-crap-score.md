---
"@stainless-code/codemap": patch
---

Add `high-crap-score` recipe: CRAP ranking with measured coverage when ingested, or graph-estimated 85/40/0% tiers from test reachability otherwise.

Extend `unimported-exports` with `unresolved_import_blind_spot` reason and `evidence_json` (unresolved import hop) so dead-export / high-CRAP triage does not over-trust the graph past alias blind spots.
