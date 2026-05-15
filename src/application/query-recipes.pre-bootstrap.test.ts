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

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "codemap-pre-bootstrap-"));
    mkdirSync(join(projectRoot, ".codemap", "recipes"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".codemap", "recipes", "team-fixture.sql"),
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
    expect(projectIds).toContain("team-fixture");
    expect(getQueryRecipeSql("team-fixture")).toContain("SELECT 1");
  });

  it("clears project recipes when override is reset to undefined", () => {
    setQueryRecipesProjectRoot(projectRoot);
    expect(listQueryRecipeIds()).toContain("team-fixture");
    setQueryRecipesProjectRoot(undefined);
    expect(listQueryRecipeIds()).not.toContain("team-fixture");
  });

  it("re-setting the override to a new root invalidates the cache", () => {
    setQueryRecipesProjectRoot(projectRoot);
    expect(listQueryRecipeIds()).toContain("team-fixture");

    const otherRoot = mkdtempSync(join(tmpdir(), "codemap-pre-bootstrap-"));
    try {
      mkdirSync(join(otherRoot, ".codemap", "recipes"), { recursive: true });
      writeFileSync(
        join(otherRoot, ".codemap", "recipes", "other-fixture.sql"),
        "SELECT 2\n",
      );
      setQueryRecipesProjectRoot(otherRoot);
      const ids = listQueryRecipeIds();
      expect(ids).toContain("other-fixture");
      expect(ids).not.toContain("team-fixture");
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});
