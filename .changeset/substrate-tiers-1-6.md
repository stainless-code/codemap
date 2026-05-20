---
"@stainless-code/codemap": minor
---

Substrate tiers 1–6 remainder (excludes C.9 / `files.is_entry`). **Schema bump** `SCHEMA_VERSION` 27 → **34** — first run after upgrade auto-rebuilds `.codemap/index.db` via the existing version-mismatch path.

**Tier 1 — call + import precision**

- `calls.{args_count,is_method_call,is_constructor_call,is_optional_chain}`; constructor vs call dedup key fix
- `symbols.{return_type,is_async,is_generator}`
- Side-effect `import_specifiers` rows (`kind='side-effect'`) + `import_id` FK to `imports`

**Tier 2 — bindings**

- `bindings.resolution_kind='re-exported'` when resolution walks a re-export chain

**Tier 3 — JSX**

- New tables `jsx_elements` / `jsx_attributes`; extractor with per-file parent linking post-pass

**Tier 5 — behavioral**

- New tables `async_calls`, `try_catch`, `decorators`, `jsdoc_tags`; context stack for `in_loop` / `in_try`

**Tier 6 — module graph (no entry points)**

- `dynamic_imports` table + extractor
- Post-pass `files.is_barrel` and parse-time `files.has_side_effects`

**Recipes + goldens:** `find-call-sites` (extended), `find-async-functions`, `find-dynamic-imports`, `find-barrel-files`, `find-side-effect-files`, `find-re-exported-bindings`, `find-side-effect-imports`, `find-jsx-usages`, `find-await-in-loop`, `find-swallowed-errors`, `find-decorator-usage`, `find-throws-jsdoc`.

**Out of scope:** C.9 plugin layer (`files.is_entry`, reachability-from-entry); tiers 7–13.

**Migration:** No in-place DDL — rebuild on schema mismatch preserves user-data tables (`coverage`, `query_baselines`, `recipe_recency`). Re-run `codemap --full` (or any index) after upgrade.
