---
"@stainless-code/codemap": patch
---

Fix incremental detection reporting unchanged files as "changed" on every run when the working tree has uncommitted modifications. `getChangedFiles` now compares content hashes against the index before including candidates, so only truly modified files enter the indexing pipeline.
