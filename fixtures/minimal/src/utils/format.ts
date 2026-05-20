/**
 * @deprecated Drift detector for the SARIF / GH-annotations golden output.
 * Pair with `now()` in `./date.ts` to give recipes >1 row to render.
 */
export function epochMs(): number {
  // FIXME: drift detector marker for FTS + deprecated join recipes
  return Date.now();
}

/**
 * @beta Fixture for the `visibility-tags` recipe — lock-in for the four-tag
 * coverage (alongside `@internal`, `@alpha`, `@private`).
 */
export function nowIso(): string {
  return new Date().toISOString();
}
