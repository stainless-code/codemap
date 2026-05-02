import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { initCodemap } from "../runtime";
import {
  _resetRecipesCacheForTests,
  getQueryRecipeActions,
  getQueryRecipeCatalogEntry,
  getQueryRecipeSql,
  listQueryRecipeCatalog,
  listQueryRecipeIds,
  resolveProjectRecipesDir,
} from "./query-recipes";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "query-recipes-"));
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
  _resetRecipesCacheForTests();
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  _resetRecipesCacheForTests();
});

describe("resolveProjectRecipesDir", () => {
  it("returns undefined when .codemap/recipes/ is absent", () => {
    expect(resolveProjectRecipesDir(projectRoot)).toBeUndefined();
  });

  it("returns the directory path when present", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    expect(resolveProjectRecipesDir(projectRoot)).toBe(recipesDir);
  });

  it("returns undefined when .codemap/recipes is a file (not directory)", () => {
    mkdirSync(join(projectRoot, ".codemap"), { recursive: true });
    writeFileSync(join(projectRoot, ".codemap", "recipes"), "not a dir");
    expect(resolveProjectRecipesDir(projectRoot)).toBeUndefined();
  });
});

describe("query-recipes shim — project recipes via runtime root", () => {
  it("bundled-only when no .codemap/recipes/ exists", () => {
    const ids = listQueryRecipeIds();
    expect(ids).toContain("fan-out");
    expect(ids).toContain("deprecated-symbols");
    // No project recipes; every entry in the catalog has source: "bundled".
    // (catalog shape is the legacy QueryRecipeCatalogEntry through Tracer 4
    // — Tracer 4 adds source/body/shadows fields. For now confirm presence.)
    expect(ids.length).toBeGreaterThan(0);
  });

  it("loads project-local recipes from .codemap/recipes/<id>.sql", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, "internal-flaky-tests.sql"),
      "SELECT path FROM files WHERE 1=0\n",
    );
    _resetRecipesCacheForTests();

    expect(listQueryRecipeIds()).toContain("internal-flaky-tests");
    expect(getQueryRecipeSql("internal-flaky-tests")).toContain("WHERE 1=0");
  });

  it("project recipe shadows bundled — getQueryRecipeSql returns project version", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, "fan-out.sql"),
      "SELECT 'project override' AS marker\n",
    );
    _resetRecipesCacheForTests();

    const sql = getQueryRecipeSql("fan-out");
    expect(sql).toContain("project override");
    // The bundled fan-out had `actions` (review-coupling) — project version
    // doesn't carry actions until Tracer 5 wires YAML frontmatter.
    expect(getQueryRecipeActions("fan-out")).toBeUndefined();
  });

  it("listQueryRecipeCatalog includes project recipes alongside bundled", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(join(recipesDir, "owner-fanout.sql"), "SELECT 1 AS x\n");
    _resetRecipesCacheForTests();

    const catalog = listQueryRecipeCatalog();
    const ids = catalog.map((c) => c.id);
    expect(ids).toContain("owner-fanout");
    expect(ids).toContain("fan-out");
  });
});

describe("query-recipes shim — catalog source / shadows / body fields (Tracer 4)", () => {
  it("bundled entries carry source: 'bundled' and no shadows flag", () => {
    const fanOut = listQueryRecipeCatalog().find((c) => c.id === "fan-out");
    expect(fanOut?.source).toBe("bundled");
    expect(fanOut?.shadows).toBeUndefined();
  });

  it("bundled entries carry body when sibling .md exists", () => {
    const fanOut = listQueryRecipeCatalog().find((c) => c.id === "fan-out");
    expect(fanOut?.body).toBeDefined();
    expect(fanOut?.body).toContain("Top 10 files by dependency fan-out");
  });

  it("project entries carry source: 'project' (no bundled clash → no shadows)", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(join(recipesDir, "internal-fizz.sql"), "SELECT 1\n");
    _resetRecipesCacheForTests();

    const fizz = listQueryRecipeCatalog().find((c) => c.id === "internal-fizz");
    expect(fizz?.source).toBe("project");
    expect(fizz?.shadows).toBeUndefined();
  });

  it("project recipe shadowing bundled carries shadows: true", () => {
    const recipesDir = join(projectRoot, ".codemap", "recipes");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, "fan-out.sql"),
      "SELECT 'project override' AS marker\n",
    );
    _resetRecipesCacheForTests();

    const fanOut = listQueryRecipeCatalog().find((c) => c.id === "fan-out");
    expect(fanOut?.source).toBe("project");
    expect(fanOut?.shadows).toBe(true);
  });
});

describe("getQueryRecipeCatalogEntry (single-id lookup)", () => {
  it("returns the same entry shape as listQueryRecipeCatalog for known id", () => {
    const fromList = listQueryRecipeCatalog().find((c) => c.id === "fan-out");
    const fromGet = getQueryRecipeCatalogEntry("fan-out");
    expect(fromGet).toEqual(fromList);
  });

  it("returns undefined for unknown id", () => {
    expect(getQueryRecipeCatalogEntry("no-such-recipe")).toBeUndefined();
  });
});
