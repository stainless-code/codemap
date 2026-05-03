// 2-node static call cycle with `./store.ts` (`invalidate ↔ write`) for
// `codemap impact` cycle-detection. `get → read` is a separate non-cyclic edge.

import { read, write } from "./store";

const _data: Map<string, string> = new Map();

export function get(key: string): string | undefined {
  if (!_data.has(key)) {
    const fresh = read(key);
    if (fresh !== undefined) _data.set(key, fresh);
  }
  return _data.get(key);
}

export function invalidate(key: string): void {
  _data.delete(key);
  // Parse-only: AST records `invalidate → write` edge; guard prevents runtime recursion.
  if (key === "__codemap_unreachable__") write(key, "");
}
