---
actions:
  - type: flag-caller
    description: "Warn before suggesting changes that depend on this symbol; check callers via the calls table."
  - type: apply-migrate-deprecated
    description: "Rewrite call/import sites — set symbol from row `name` and replacement identifier."
    command: codemap apply migrate-deprecated --params symbol=<name>,replacement=<replacement> --dry-run
  - type: apply-deprecated-usages
    description: "Rewrite the @deprecated JSDoc line on the definition — set symbol from row `name`."
    command: codemap apply deprecated-usages --params symbol=<name>,replacement_message=<message> --dry-run
  - type: apply-add-jsdoc-deprecated
    description: "Insert @deprecated JSDoc when the symbol is not yet tagged."
    command: codemap apply add-jsdoc-deprecated --params name=<name>,replacement=<replacement> --dry-run --force
---

# deprecated-symbols

Symbols whose JSDoc contains @deprecated (caller-warning candidates).

```bash
codemap query --recipe deprecated-symbols --format json
```

Useful for agents to flag callers of soon-to-be-removed APIs before suggesting changes. Pair with [`migrate-deprecated`](./migrate-deprecated.md) and [`deprecated-usages`](./deprecated-usages.md) for writes; `actions[].command` on `--json` rows is the apply hint (replace `<name>` / `<replacement>` from the row).
