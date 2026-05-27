import type { CodemapDatabase } from "../db";

/** Default char budget for trace/explore/node snippet payloads (plan L.3). */
export const DEFAULT_OUTPUT_CHAR_BUDGET = 15_000;

/** Default row cap for explore before `truncation.rows` (structural payload guard). */
export const DEFAULT_EXPLORE_ROW_LIMIT = 500;

export interface OutputBudget {
  snippet_char_budget: number;
  explore_row_limit: number;
}

/**
 * Scale trace/explore/node snippet and row caps from indexed file count — same
 * tier boundaries as {@link resolveContextBudget} in context-engine.
 */
export function resolveOutputBudget(fileCount: number): OutputBudget {
  if (fileCount <= 500) {
    return {
      snippet_char_budget: DEFAULT_OUTPUT_CHAR_BUDGET,
      explore_row_limit: DEFAULT_EXPLORE_ROW_LIMIT,
    };
  }
  if (fileCount <= 5000) {
    return {
      snippet_char_budget: 10_000,
      explore_row_limit: 250,
    };
  }
  return {
    snippet_char_budget: 6_000,
    explore_row_limit: 125,
  };
}

export function readIndexedFileCount(db: CodemapDatabase): number {
  const row = db.query("SELECT COUNT(*) AS n FROM files").get() as {
    n: number;
  };
  return row.n;
}

/** Explicit `budget_chars` wins; otherwise adaptive cap from indexed file count. */
export function resolveEffectiveSnippetBudget(
  db: CodemapDatabase,
  budgetChars?: number,
): number {
  if (budgetChars !== undefined) return budgetChars;
  return resolveOutputBudget(readIndexedFileCount(db)).snippet_char_budget;
}

/** Explicit `rowLimit` wins; otherwise adaptive cap from indexed file count. */
export function resolveEffectiveExploreRowLimit(
  db: CodemapDatabase,
  rowLimit?: number,
): number {
  if (rowLimit !== undefined) return rowLimit;
  return resolveOutputBudget(readIndexedFileCount(db)).explore_row_limit;
}

export interface SourceCharBudgetResult<
  T extends { source?: string | undefined },
> {
  items: T[];
  truncated: boolean;
}

/** Keep items in order until cumulative `source` length exceeds `budget`. */
export function applySourceCharBudget<
  T extends { source?: string | undefined },
>(items: T[], budget: number): SourceCharBudgetResult<T> {
  if (budget <= 0) return { items: [], truncated: items.length > 0 };
  let used = 0;
  const out: T[] = [];
  for (const item of items) {
    const len = item.source?.length ?? 0;
    if (used + len > budget) {
      return { items: out, truncated: true };
    }
    out.push(item);
    used += len;
  }
  return { items: out, truncated: false };
}
