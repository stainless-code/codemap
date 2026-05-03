// Pair with `./store.ts` to form a 2-node call cycle:
//   cache.get → store.read → cache.invalidate → store.write → cache.get
// Exercises `codemap impact`'s cycle-detection (path-string `instr` check).

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
  write(key, "");
}
