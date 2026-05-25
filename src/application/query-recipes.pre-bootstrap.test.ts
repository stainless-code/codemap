import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _resetRecipesCacheForTests,
  getQueryRecipeSql,
  listQueryRecipeCatalog,
  listQueryRecipeIds,
  setQueryRecipesProjectRoot,
} from "./query-recipes";

/**
 * Regression — `parseQueryRest` validates `--recipe <id>` / `--recipes-json` /
 * `--print-sql <id>` BEFORE `runQueryCmd` calls `bootstrapCodemap`, so the
 * registry has historically seen `getProjectRoot()` throw and silently
 * fallen back to bundled-only. `main.ts` now plumbs the resolved `--root`
 * (from `parseBootstrapArgs`) into `setQueryRecipesProjectRoot` so the
 * parser-phase discovery sees the project's recipes.
 *
 * The tests below deliberately DO NOT call `initCodemap()` — they exercise
 * the override-only path the CLI parser hits.
 */
describe("setQueryRecipesProjectRoot — pre-bootstrap CLI parse-phase path", () => {
  let projectRoot: string;
  // Per-test unique ids so the assertions can't collide with a future bundled
  // recipe of the same name.
  let primaryId: string;
  let otherId: string;

  beforeEach(() => {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    primaryId = `team-fixture-${suffix}`;
    otherId = `other-fixture-${suffix}`;
    projectRoot = mkdtempSync(join(tmpdir(), "codemap-pre-bootstrap-"));
    mkdirSync(join(projectRoot, ".codemap", "recipes"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".codemap", "recipes", `${primaryId}.sql`),
      "SELECT 1 AS ok\n",
    );
    _resetRecipesCacheForTests();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    _resetRecipesCacheForTests();
  });

  it("loads project recipes when only the override is set (no initCodemap)", () => {
    setQueryRecipesProjectRoot(projectRoot);
    const catalog = listQueryRecipeCatalog();
    const projectIds = catalog
      .filter((c) => c.source === "project")
      .map((c) => c.id);
    expect(projectIds).toContain(primaryId);
    expect(getQueryRecipeSql(primaryId)).toContain("SELECT 1");
  });

  it("clears project recipes when override is reset to undefined", () => {
    setQueryRecipesProjectRoot(projectRoot);
    expect(listQueryRecipeIds()).toContain(primaryId);
    setQueryRecipesProjectRoot(undefined);
    expect(listQueryRecipeIds()).not.toContain(primaryId);
  });

  it("re-setting the override to a new root invalidates the cache", () => {
    setQueryRecipesProjectRoot(projectRoot);
    expect(listQueryRecipeIds()).toContain(primaryId);

    const otherRoot = mkdtempSync(join(tmpdir(), "codemap-pre-bootstrap-"));
    try {
      mkdirSync(join(otherRoot, ".codemap", "recipes"), { recursive: true });
      writeFileSync(
        join(otherRoot, ".codemap", "recipes", `${otherId}.sql`),
        "SELECT 2\n",
      );
      setQueryRecipesProjectRoot(otherRoot);
      const ids = listQueryRecipeIds();
      expect(ids).toContain(otherId);
      expect(ids).not.toContain(primaryId);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("loads project recipes from a custom --state-dir before bootstrap", () => {
    const recipesDir = join(projectRoot, ".cm", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(join(recipesDir, `${primaryId}.sql`), "SELECT 3 AS ok\n");
    setQueryRecipesProjectRoot(projectRoot, ".cm");
    expect(listQueryRecipeIds()).toContain(primaryId);
    expect(getQueryRecipeSql(primaryId)).toContain("SELECT 3");
  });

  it("invalidates the cache when --state-dir changes for the same root", () => {
    const cmDir = join(projectRoot, ".cm", "recipes");
    const otherDir = join(projectRoot, ".other", "recipes");
    mkdirSync(cmDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(cmDir, `${primaryId}.sql`), "SELECT 3\n");
    writeFileSync(join(otherDir, `${otherId}.sql`), "SELECT 4\n");
    setQueryRecipesProjectRoot(projectRoot, ".cm");
    expect(listQueryRecipeIds()).toContain(primaryId);
    setQueryRecipesProjectRoot(projectRoot, ".other");
    const ids = listQueryRecipeIds();
    expect(ids).toContain(otherId);
    expect(ids).not.toContain(primaryId);
  });
});
