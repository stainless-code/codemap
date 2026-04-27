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
