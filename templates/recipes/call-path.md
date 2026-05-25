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

Shortest path between two symbols via a cycle-safe recursive walk on `calls`, with optional file-import fallback.

**`via` modes:**

- **`calls`** (default) — symbol-level call edges only. Each row is a real `calls` site with a source line.
- **`dependencies`** — file-level import path between files that define `from` and `to`. Rows use **file paths** as `caller_name` / `callee_name` and `line_start = 0`. Returns `[]` when both symbols live in the same file (no import hop).
- **`all`** — call path when one exists; otherwise the shortest file-import path. Never mixes backends in one result.

Empty `[]` means no path within `max_depth`, unknown symbol names, or `from = to` with no self-call edge.

```bash
codemap query --recipe call-path --params from=createClient,to=handshake
codemap query --recipe call-path --params from=run,to=handshake,via=all
codemap query --recipe call-path --params from=run,to=handshake,via=dependencies
```

Returns one row per hop: `file_path`, `caller_name`, `callee_name`, `line_start`, `hop`, `via`.
