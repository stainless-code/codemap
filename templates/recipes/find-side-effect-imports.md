# find-side-effect-imports

Side-effect-only import statements (`import "./mod"` with no bindings).

```bash
codemap query --recipe find-side-effect-imports
```

`import_id` FK links each row to the parent `imports` row.
