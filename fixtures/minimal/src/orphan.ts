// codemap-ignore-next-line unimported-exports
export function ignoredExport(): string {
  return "suppressed";
}

/** Never imported — `unimported-exports` golden target. */
export function orphanHelper(): string {
  return "orphan";
}
