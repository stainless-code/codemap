---
actions:
  - type: flag-caller
    description: "Warn before suggesting changes that depend on this symbol; check callers via the calls table."
  - type: apply-migrate-deprecated
    description: "Rewrite call/import sites — replace SYMBOL with row `name`, REPLACEMENT with the new identifier."
    command: codemap apply migrate-deprecated --params symbol=SYMBOL,replacement=REPLACEMENT --dry-run
  - type: apply-deprecated-usages
    description: "Rewrite the @deprecated JSDoc line — replace SYMBOL with row `name`, MESSAGE with the deprecation text."
    command: codemap apply deprecated-usages --params symbol=SYMBOL,replacement_message=MESSAGE --dry-run
  - type: apply-add-jsdoc-deprecated
    description: "Insert @deprecated JSDoc when the symbol is not yet tagged — replace SYMBOL/REPLACEMENT from row `name` and chosen replacement."
    command: codemap apply add-jsdoc-deprecated --params name=SYMBOL,replacement=REPLACEMENT --dry-run --force
---

# deprecated-symbols

Symbols whose JSDoc contains @deprecated (caller-warning candidates).

```bash
codemap query --recipe deprecated-symbols --format json
```

Useful for agents to flag callers of soon-to-be-removed APIs before suggesting changes. Pair with [`migrate-deprecated`](./migrate-deprecated.md) and [`deprecated-usages`](./deprecated-usages.md) for writes; `actions[].command` on `--json` rows is the apply hint (replace `SYMBOL` / `REPLACEMENT` / `MESSAGE` from each row before apply).
