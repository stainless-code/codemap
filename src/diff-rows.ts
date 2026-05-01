/**
 * Multiset diff keyed on canonical `JSON.stringify(row)`. Naive `Set` diff
 * would collapse duplicates: a baseline of `[A, A]` vs current `[A]` would
 * report no removal even though one `A` is gone. Frequency maps preserve
 * cardinality so non-`DISTINCT` queries (e.g. `SELECT name FROM symbols`)
 * diff correctly.
 *
 * Still no "changed" category — that needs a row-key heuristic; agents can
 * derive richer diffs from the raw row sets if needed.
 *
 * Used by both `codemap query --baseline` (CLI) and `codemap audit --baseline`
 * (engine). Lives at `src/` (not under `cli/` or `application/`) because
 * it's a pure utility with no dependency direction — same pattern as
 * `git-changed.ts`.
 */
export function diffRows(
  baseline: unknown[],
  current: unknown[],
): { added: unknown[]; removed: unknown[] } {
  const countKeys = (rows: unknown[]) => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = JSON.stringify(r);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const baseCounts = countKeys(baseline);
  const curCounts = countKeys(current);

  const added: unknown[] = [];
  for (const r of current) {
    const k = JSON.stringify(r);
    const remaining = baseCounts.get(k) ?? 0;
    if (remaining > 0) baseCounts.set(k, remaining - 1);
    else added.push(r);
  }
  const removed: unknown[] = [];
  for (const r of baseline) {
    const k = JSON.stringify(r);
    const remaining = curCounts.get(k) ?? 0;
    if (remaining > 0) curCounts.set(k, remaining - 1);
    else removed.push(r);
  }
  return { added, removed };
}
