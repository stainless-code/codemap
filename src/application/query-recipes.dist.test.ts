/**
 * Regression for the 0.6.0 → 0.6.1 resolver fix — the bundled-recipes
 * resolver walked one directory too far up the tree, so `--recipes-json`
 * returned `[]` even though the tarball shipped the bundled recipes correctly.
 * Binary-level dist smoke lives in `.github/workflows/ci.yml`.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";

import {
  listQueryRecipeCatalog,
  resolveBundledRecipesDir,
} from "./query-recipes";

describe("resolveBundledRecipesDir — published artifact path resolution", () => {
  it("returns an existing directory", () => {
    const dir = resolveBundledRecipesDir();
    expect(existsSync(dir)).toBe(true);
  });

  it("contains at least one bundled .sql recipe", () => {
    const dir = resolveBundledRecipesDir();
    const sqls = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(sqls.length).toBeGreaterThan(0);
  });

  it("contains at least one bundled .md sibling", () => {
    const dir = resolveBundledRecipesDir();
    const mds = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(mds.length).toBeGreaterThan(0);
  });

  it("populates `listQueryRecipeCatalog()` with the bundled set", () => {
    const catalog = listQueryRecipeCatalog();
    // `> 0` rather than a hard count so adding / removing recipes doesn't
    // break the regression guard — the bug it catches is an EMPTY catalog.
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((r) => r.source === "bundled")).toBe(true);
  });
});
