---
params:
  - name: callee
    type: string
    required: true
    description: Exact callee name (`foo`, `obj.foo`, `this.foo` — same shape as `calls.callee_name`).
actions:
  - type: navigate-to-call-sites
    description: "Each row carries `file_path:line_start:column_start` for IDE / agent navigation; column-precise per R.6 (callee identifier token, not the surrounding CallExpression)."
---

# find-call-sites

List every parse-resolved call site of a named function with column-precise position (excludes `provenance = 'heuristic'` — same Moat-A filter as `call-path`). Foundation for app-wide rename and replace-deprecated-call recipes (Tier 6 extension of `rename-preview`). For callback-synthesis edges, use `calls-including-heuristic`.

```bash
codemap query --recipe find-call-sites --params callee=createClient
```

Member-expression callees match on the full dot-joined name:

```bash
codemap query --recipe find-call-sites --params callee=Date.now
codemap query --recipe find-call-sites --params callee=this.foo
```

`column_start` / `column_end` are byte offsets within `line_start` (0-indexed; end is one-past-last per R.6 + LSP `Location` convention).
