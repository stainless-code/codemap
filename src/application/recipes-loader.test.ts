import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadAllRecipes,
  mergeRecipes,
  readRecipesFromDir,
} from "./recipes-loader";
import type { LoadedRecipe } from "./recipes-loader";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "recipes-loader-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeRecipeDir(name: string): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("readRecipesFromDir", () => {
  it("returns [] when directory doesn't exist (project-recipes case)", () => {
    expect(readRecipesFromDir(join(workDir, "missing"), "project")).toEqual([]);
  });

  it("ignores non-.sql files", () => {
    const dir = makeRecipeDir("ignore-noise");
    writeFileSync(join(dir, "fan-out.sql"), "SELECT 1\n");
    writeFileSync(join(dir, "README.md"), "# unrelated\n");
    writeFileSync(join(dir, ".DS_Store"), "");
    const r = readRecipesFromDir(dir, "bundled");
    expect(r.map((x) => x.id)).toEqual(["fan-out"]);
  });

  it("loads SQL only — no sibling .md → description/body/actions undefined", () => {
    const dir = makeRecipeDir("sql-only");
    writeFileSync(join(dir, "fan-out.sql"), "SELECT 1\n");
    const r = readRecipesFromDir(dir, "bundled");
    expect(r).toHaveLength(1);
    const recipe = r[0]!;
    expect(recipe).toMatchObject({
      id: "fan-out",
      sql: "SELECT 1\n",
      description: undefined,
      body: undefined,
      actions: undefined,
      source: "bundled",
      shadows: false,
    });
  });

  it("pairs sibling .md — description = first non-empty line, body = full text", () => {
    const dir = makeRecipeDir("with-md");
    writeFileSync(join(dir, "fan-out.sql"), "SELECT 1\n");
    writeFileSync(
      join(dir, "fan-out.md"),
      "# Fan-out\n\nWhen to use: …\n\nFollow-up SQL: …\n",
    );
    const r = readRecipesFromDir(dir, "bundled");
    expect(r[0]!.description).toBe("Fan-out");
    expect(r[0]!.body).toContain("When to use");
  });

  it("description strips leading `# ` heading marker", () => {
    const dir = makeRecipeDir("md-headers");
    writeFileSync(join(dir, "x.sql"), "SELECT 1\n");
    writeFileSync(join(dir, "x.md"), "## Heading two\n\ncontent\n");
    expect(readRecipesFromDir(dir, "bundled")[0]!.description).toBe(
      "Heading two",
    );
  });

  it("returns recipes sorted by id (deterministic order)", () => {
    const dir = makeRecipeDir("ordering");
    writeFileSync(join(dir, "zebra.sql"), "SELECT 1\n");
    writeFileSync(join(dir, "alpha.sql"), "SELECT 2\n");
    writeFileSync(join(dir, "monkey.sql"), "SELECT 3\n");
    const r = readRecipesFromDir(dir, "project");
    expect(r.map((x) => x.id)).toEqual(["alpha", "monkey", "zebra"]);
  });

  it("throws on empty SQL (just whitespace + comments)", () => {
    const dir = makeRecipeDir("empty");
    writeFileSync(
      join(dir, "blank.sql"),
      "-- this is just a comment\n   \n-- and another\n",
    );
    expect(() => readRecipesFromDir(dir, "project")).toThrow(/empty/);
  });

  it("counts SQL with content as non-empty even with leading comments", () => {
    const dir = makeRecipeDir("comments-then-sql");
    writeFileSync(
      join(dir, "x.sql"),
      "-- doc comment line\nSELECT path FROM files\n",
    );
    expect(readRecipesFromDir(dir, "bundled")).toHaveLength(1);
  });

  it("returns [] for a non-directory path (not an error)", () => {
    const filePath = join(workDir, "actually-a-file.txt");
    writeFileSync(filePath, "");
    expect(readRecipesFromDir(filePath, "bundled")).toEqual([]);
  });
});

describe("mergeRecipes", () => {
  function recipe(id: string, source: LoadedRecipe["source"]): LoadedRecipe {
    return {
      id,
      sql: `SELECT '${id}'`,
      description: undefined,
      body: undefined,
      actions: undefined,
      source,
      shadows: false,
    };
  }

  it("project-only — no shadows, no merging", () => {
    const r = mergeRecipes(
      [],
      [recipe("a", "project"), recipe("b", "project")],
    );
    expect(r.map((x) => `${x.id}:${x.source}:${x.shadows}`)).toEqual([
      "a:project:false",
      "b:project:false",
    ]);
  });

  it("bundled-only — passes through, sorted by id", () => {
    const r = mergeRecipes(
      [recipe("zebra", "bundled"), recipe("alpha", "bundled")],
      [],
    );
    expect(r.map((x) => x.id)).toEqual(["alpha", "zebra"]);
  });

  it("project shadows bundled — project wins, shadows: true", () => {
    const r = mergeRecipes(
      [recipe("fan-out", "bundled"), recipe("fan-in", "bundled")],
      [recipe("fan-out", "project")],
    );
    const fanOut = r.find((x) => x.id === "fan-out")!;
    expect(fanOut.source).toBe("project");
    expect(fanOut.shadows).toBe(true);
    // bundled fan-out is filtered out — only one entry per id.
    expect(r.filter((x) => x.id === "fan-out")).toHaveLength(1);
    // unrelated bundled recipe still present.
    const fanIn = r.find((x) => x.id === "fan-in")!;
    expect(fanIn.source).toBe("bundled");
    expect(fanIn.shadows).toBe(false);
  });

  it("project recipe with no bundled match — shadows: false", () => {
    const r = mergeRecipes(
      [recipe("fan-out", "bundled")],
      [recipe("internal-flaky-tests", "project")],
    );
    const internal = r.find((x) => x.id === "internal-flaky-tests")!;
    expect(internal.shadows).toBe(false);
  });
});

describe("loadAllRecipes — bundled + project composition", () => {
  it("loads bundled-only when projectDir is undefined", () => {
    const dir = makeRecipeDir("bundled-only");
    writeFileSync(join(dir, "fan-out.sql"), "SELECT 1\n");
    const r = loadAllRecipes({ bundledDir: dir, projectDir: undefined });
    expect(r).toHaveLength(1);
    expect(r[0]!.source).toBe("bundled");
  });

  it("loads bundled + project, sorted by id", () => {
    const bundledDir = makeRecipeDir("bundled");
    const projectDir = makeRecipeDir("project");
    writeFileSync(join(bundledDir, "fan-out.sql"), "SELECT 1\n");
    writeFileSync(
      join(projectDir, "internal-flaky-tests.sql"),
      "SELECT path FROM files\n",
    );
    const r = loadAllRecipes({ bundledDir, projectDir });
    expect(r.map((x) => `${x.id}:${x.source}`)).toEqual([
      "fan-out:bundled",
      "internal-flaky-tests:project",
    ]);
  });

  it("project recipe shadows bundled with same id (project wins, shadows: true)", () => {
    const bundledDir = makeRecipeDir("bundled-shadowed");
    const projectDir = makeRecipeDir("project-shadowing");
    writeFileSync(join(bundledDir, "fan-out.sql"), "SELECT 1\n");
    writeFileSync(
      join(projectDir, "fan-out.sql"),
      "SELECT 'project version'\n",
    );
    const r = loadAllRecipes({ bundledDir, projectDir });
    expect(r).toHaveLength(1);
    const recipe = r[0]!;
    expect(recipe.source).toBe("project");
    expect(recipe.shadows).toBe(true);
    expect(recipe.sql).toContain("project version");
  });

  it("missing .codemap/recipes/ directory is not an error", () => {
    const bundledDir = makeRecipeDir("bundled");
    writeFileSync(join(bundledDir, "x.sql"), "SELECT 1\n");
    const r = loadAllRecipes({
      bundledDir,
      projectDir: join(workDir, "does-not-exist"),
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.source).toBe("bundled");
  });
});
