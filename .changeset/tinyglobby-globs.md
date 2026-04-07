---
"@stainless-code/codemap": patch
---

Replace `fast-glob` with `tinyglobby` for Node include globs. Smaller dependency footprint; `expandDirectories: false` keeps matching aligned with the previous behavior.
