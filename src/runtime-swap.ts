/** Depth of nested audit worktree root swaps (exempt from root-switch guard). */
let _runtimeSwapDepth = 0;

/** Enter audit worktree bracket — `initCodemap` may switch roots while depth > 0. */
export function enterRuntimeSwap(): void {
  _runtimeSwapDepth++;
}

/** Leave audit worktree bracket — must pair every `enterRuntimeSwap`. */
export function exitRuntimeSwap(): void {
  if (_runtimeSwapDepth > 0) _runtimeSwapDepth--;
}

/** True while inside `makeWorktreeReindex` save/swap/restore. */
export function isRuntimeSwapActive(): boolean {
  return _runtimeSwapDepth > 0;
}

/** Maintainer test helper — clears swap depth between test cases. */
export function resetRuntimeSwapForTest(): void {
  _runtimeSwapDepth = 0;
}
