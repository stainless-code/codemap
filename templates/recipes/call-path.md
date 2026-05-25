---
params:
  - name: from
    type: string
    required: true
    description: Start symbol name (matches `calls.caller_name` / `calls.callee_name`).
  - name: to
    type: string
    required: true
    description: End symbol name.
  - name: max_depth
    type: number
    required: false
    default: 10
    description: Maximum call hops to explore (cycle-safe).
  - name: via
    type: string
    required: false
    default: calls
    description: Edge backend — `calls` (default), `dependencies`, or `all`.
actions:
  - type: trace-call-path
    description: "Ordered hop rows — pair with `codemap snippet` per `file_path` + `line_start`."
---

# call-path

Shortest call path between two symbols via a cycle-safe recursive walk on `calls` (and optional `dependencies` when `via=dependencies|all`).

```bash
codemap query --recipe call-path --params from=createClient,to=handshake
codemap query --recipe call-path --params from=createClient,to=handshake,max_depth=5,via=calls
```

Returns one row per hop: `file_path`, `caller_name`, `callee_name`, `line_start`, `hop`, `via`.
