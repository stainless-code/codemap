---
actions:
  - type: flag-caller
    description: "Warn before suggesting changes that depend on this symbol; check callers via the calls table."
---

Symbols whose JSDoc contains @deprecated (caller-warning candidates)

Useful for agents to flag callers of soon-to-be-removed APIs before suggesting changes. Pair with `WHERE callee_name = '<symbol>'` against the `calls` table to find the actual call sites.
