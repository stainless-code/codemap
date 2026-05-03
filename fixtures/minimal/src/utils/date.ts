/**
 * @deprecated Use `Date.now()` directly. Kept as a fixture for the
 * `deprecated-symbols` recipe golden test.
 */
export function now(): number {
  return Date.now();
}

/**
 * @internal Implementation helper — fixture for the `visibility-tags` recipe.
 */
export function _epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * @alpha Experimental — fixture for `visibility-tags` four-tag coverage.
 */
export function nanoseconds(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/**
 * @private Internal-only utility — fixture for `visibility-tags` four-tag coverage.
 */
export function _hiResEpoch(): number {
  return performance.now();
}
