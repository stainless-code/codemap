/** Default char budget for trace/explore/node snippet payloads (plan L.3). */
export const DEFAULT_OUTPUT_CHAR_BUDGET = 15_000;

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
