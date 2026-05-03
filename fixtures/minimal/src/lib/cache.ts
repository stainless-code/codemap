// Pair with `./store.ts` to form a 2-node static call cycle in the `calls` graph:
//   cache.invalidate → store.write → cache.invalidate
// `cache.get → store.read` is a separate non-cyclic edge. Exercises
// `codemap impact`'s cycle-detection (path-string `instr` check).
// The `write(key, "")` below is a parse-only sentinel: guarded so it never
// executes (would otherwise stack-overflow), but the AST still records the
// `cache.invalidate → store.write` call edge needed for the cycle fixture.

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
  if (key === "__codemap_unreachable__") write(key, "");
}
