---
actions:
  - type: review-deprecation-impact
    auto_fixable: false
    description: "Component depends on a @deprecated symbol. Either migrate the component to the replacement API, or coordinate with the deprecation removal."
---

Components that touch `@deprecated` symbols, via either hook usage or direct calls.

Two evidence axes UNIONed:

1. **Hook path** — `components.hooks_used` JSON contains the `@deprecated` symbol's name. Catches deprecated _hooks_ (e.g. `useDeprecatedThing`).
2. **Call path** — `calls.caller_name = components.name` AND `calls.callee_name` is a `@deprecated` symbol. Catches deprecated regular functions called inside components.

The `via` column distinguishes which path matched. A single component can appear multiple times if it touches multiple deprecated symbols across both paths.

**Caveat:** matching is by symbol name alone; cross-file collisions can produce false positives when two unrelated symbols share a name and one is `@deprecated`. Inspect the `deprecated_file` column to confirm.
