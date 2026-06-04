# Framework route extraction — plan

> **Status:** open · **Priority:** P2 · **Effort:** L (~3–4 weeks) · **Trigger-gated**
>
> **Motivator:** Agents ask "what handles `/api/users`?" and reachability recipes false-positive framework entry files without route awareness. Static HTTP route extraction closes the gap for TS/JS web stacks.
>
> **Roadmap:** [§ Backlog](../roadmap.md#backlog) · extends [c9-plugin-layer](./c9-plugin-layer.md) · ships after C.9 contract exists

---

## Pre-locked decisions

| #   | Decision                                                                                                                                           | Source                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| L.1 | **Extends C.9 plugin contract** — plugins may emit route rows, not just `is_entry` hints.                                                          | [c9-plugin-layer](./c9-plugin-layer.md)                          |
| L.2 | **Moat-B substrate** — new table `routes` (or `http_routes`): `method`, `path_pattern`, `handler_symbol`, `file_path`, `line_start`, `framework`.  | [Moat B](../roadmap.md#moats-load-bearing)                       |
| L.3 | **Moat-A exposure** — bundled recipe `http-routes` + parametrised `find-route-by-path`.                                                            | Moat A                                                           |
| L.4 | **Static extraction only** — regex/AST patterns on oxc-parsed files; no runtime route registration.                                                | [Floor — No JS execution](../roadmap.md#floors-v1-product-shape) |
| L.5 | **v1 frameworks:** Express, React Router v6, NestJS decorators. Next.js App Router entry hints stay on C.9 `is_entry` until route patterns proven. | TS/JS depth first                                                |

---

## Schema sketch

```sql
CREATE TABLE http_routes (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  framework TEXT NOT NULL,
  method TEXT,           -- GET|POST|*|USE
  path_pattern TEXT NOT NULL,
  handler_name TEXT,
  handler_symbol_id INTEGER,
  line_start INTEGER NOT NULL
);
```

---

## Bundled plugins (v1)

| Plugin id      | Detect                                | Extract patterns                      |
| -------------- | ------------------------------------- | ------------------------------------- |
| `express`      | `express` import / `app.get/post/...` | CallExpression on `app`/`router`      |
| `react-router` | `createBrowserRouter`, `<Route path=` | JSX `Route` elements + config objects |
| `nestjs`       | `@Controller`, `@Get/@Post`           | Decorator metadata on classes/methods |

---

## Implementation steps

1. Resolve C.9 Q1–Q3 (plugin contract + discovery + schema)
2. Add `http_routes` table + SCHEMA_VERSION bump
3. Implement three bundled plugins as static config or TS modules (no runtime eval)
4. Index hook: run plugins after file parse, insert rows
5. Recipes: `http-routes`, `find-route-by-path` (param `path_pattern`)
6. Update `untested-and-dead` / reachability docs when combined with C.9
7. Golden fixtures: minimal Express + React Router apps

---

## Acceptance

- [ ] Express app fixture indexes `GET /users` → handler symbol
- [ ] Recipe returns routes filterable by path prefix
- [ ] No new verdict-shaped CLI verb

---

## Dependencies

- **Blocked on** [c9-plugin-layer](./c9-plugin-layer.md) plugin loader (Q1–Q2 minimum)
- Synergy with JSX callback-synthesis heuristic `calls` (shipped [#164](https://github.com/stainless-code/codemap/pull/164); [architecture § `calls`](../architecture.md#calls--function-scoped-call-edges-deduped-per-file-strict)) for handler resolution

---

## Revisit trigger

Ship when C.9 contract lands OR ≥2 consumers request concrete framework targets (per roadmap).
