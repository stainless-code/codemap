---
actions:
  - type: flag-non-public
    description: "Treat as not part of the public API unless visibility = 'public': don't import from package consumers; check the visibility tag before extending re-exports."
---

Symbols carrying a JSDoc visibility tag (public / private / internal / alpha / beta)

Useful for agents to know what is _not_ part of the public API before suggesting imports or extending re-exports. The `visibility` column is structured (parsed at index time, not regex on `doc_comment`).
