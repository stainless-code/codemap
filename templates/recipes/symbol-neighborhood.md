---
params:
  - name: name
    type: string
    required: true
    description: Center symbol name (exact match on `calls.caller_name` / `calls.callee_name`).
  - name: depth
    type: number
    required: false
    default: 1
    description: Hop budget in the call graph (bidirectional).
  - name: kind
    type: string
    required: false
    description: Optional `symbols.kind` filter on neighborhood rows.
actions:
  - type: explore-neighborhood
    description: "Symbol rows at each hop — batch `codemap snippet` or `codemap show` on `name` + `file_path`."
---

# symbol-neighborhood

Budget-capped bidirectional survey around a symbol: callers and callees from `calls`, plus one-hop file dependencies (export names from adjacent files via `dependencies`).

**Depth semantics:** `depth=0` → `[]`. `depth=1` → direct call neighbors plus file-import neighbors. `depth>1` → expands transitively through the call graph; rows at hop ≥ 2 use `edge=indirect`. File-dependency rows are always `depth=1` when included.

**Homonyms:** joins `symbols` by `name` only — multiple definitions of the same name each appear as separate rows (same as `find-call-sites`).

```bash
codemap query --recipe symbol-neighborhood --params name=createClient
codemap query --recipe symbol-neighborhood --params name=createClient,depth=2,kind=function
```

Each row is a `symbols` row plus `edge` (`caller` | `callee` | `indirect` | `depends_on` | `depended_on_by`), `depth`, and `via` (`calls` | `dependencies`).
