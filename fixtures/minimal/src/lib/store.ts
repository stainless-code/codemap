// See `./cache.ts` for the cycle rationale.

import { invalidate } from "./cache";

const _backing: Map<string, string> = new Map();

export function read(key: string): string | undefined {
  return _backing.get(key);
}

export function write(key: string, value: string): void {
  _backing.set(key, value);
  invalidate(key);
}
