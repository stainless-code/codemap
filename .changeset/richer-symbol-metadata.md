---
"@stainless-code/codemap": minor
---

Richer symbol metadata: generics, return types, JSDoc, type members, const values, symbol nesting, call graph

- Signatures now include generic type parameters, return type annotations, and heritage clauses (extends/implements)
- New `doc_comment` column on symbols extracts leading JSDoc comments
- New `type_members` table indexes properties and methods of interfaces and object-literal types
- New `value` column on symbols captures const literal values (strings, numbers, booleans, null)
- New `parent_name` column on symbols tracks scope nesting; class methods/properties/getters extracted as individual symbols
- New `calls` table tracks function-scoped call edges with `caller_scope` for qualified disambiguation (deduped per file)
- Enum members extracted into `members` column as JSON
- Performance: cached scope strings, hoisted hot-path regex, batch deletes, reduced redundant I/O, BATCH_SIZE 100→500
- SCHEMA_VERSION bumped to 2
