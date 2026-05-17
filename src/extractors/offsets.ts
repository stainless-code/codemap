/**
 * Byte offset → 1-based line number. `buildLineMap` runs once per file;
 * `offsetToLine` is called many times per row push.
 */

export function buildLineMap(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** `buildLineMap(source).length` without the array — empty source still returns 1. */
export function countLines(source: string): number {
  let lineCount = 1;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineCount++;
  }
  return lineCount;
}

export function offsetToLine(lineMap: number[], offset: number): number {
  let lo = 0;
  let hi = lineMap.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineMap[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}
