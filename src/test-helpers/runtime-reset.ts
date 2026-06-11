import { afterEach, beforeEach } from "bun:test";

import { resetResolverForTest } from "../resolver";
import { resetCodemapForTest } from "../runtime";
import { resetRuntimeSwapForTest } from "../runtime-swap";

/**
 * Clears process-global codemap + resolver state. Maintainer tests only —
 * not a consumer surface.
 */
export function resetRuntimeForTest(): void {
  resetCodemapForTest();
  resetResolverForTest();
  resetRuntimeSwapForTest();
}

/**
 * Register `beforeEach` + `afterEach` reset for suites that call `initCodemap`.
 * `beforeEach` clears bleed from prior files (e.g. `createCodemap` without teardown).
 */
export function installCodemapTestTeardown(): void {
  beforeEach(() => {
    resetRuntimeForTest();
  });
  afterEach(() => {
    resetRuntimeForTest();
  });
}
