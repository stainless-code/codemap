import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractFrontmatterAndBody,
  loadAllRecipes,
  mergeRecipes,
  readRecipesFromDir,
  validateRecipeSql,
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

describe("validateRecipeSql — load-time DML/DDL deny-list", () => {
  it("accepts SELECT (the common case)", () => {
    expect(() =>
      validateRecipeSql("ok", "/tmp/ok.sql", "SELECT 1\n"),
    ).not.toThrow();
  });

  it("accepts WITH-prefixed CTEs", () => {
    expect(() =>
      validateRecipeSql(
        "cte",
        "/tmp/cte.sql",
        "WITH x AS (SELECT 1) SELECT * FROM x\n",
      ),
    ).not.toThrow();
  });

  it("rejects DELETE with recipe-aware error", () => {
    expect(() =>
      validateRecipeSql("bad", "/tmp/bad.sql", "DELETE FROM files\n"),
    ).toThrow(/recipes must be read-only/);
  });

  for (const verb of [
    "INSERT",
    "UPDATE",
    "DROP",
    "CREATE",
    "ALTER",
    "ATTACH",
    "DETACH",
    "REPLACE",
    "TRUNCATE",
    "VACUUM",
    "PRAGMA",
  ]) {
    it(`rejects ${verb} at load time`, () => {
      expect(() =>
        validateRecipeSql(
          "bad",
          "/tmp/bad.sql",
          `${verb} something arbitrary\n`,
        ),
      ).toThrow(/read-only/);
    });
  }

  it("ignores leading -- comments before the keyword", () => {
    expect(() =>
      validateRecipeSql(
        "ok",
        "/tmp/ok.sql",
        "-- doc line\n-- another doc\nSELECT 1\n",
      ),
    ).not.toThrow();
  });

  it("rejects lowercase deny-list keywords (case-insensitive)", () => {
    expect(() =>
      validateRecipeSql("bad", "/tmp/bad.sql", "drop table x\n"),
    ).toThrow(/read-only/);
  });

  it("strips block /* */ comments before deciding the first keyword", () => {
    // Without block-comment stripping, this would mis-detect 'INSERT' from the
    // comment text and reject a legitimate SELECT recipe.
    expect(() =>
      validateRecipeSql(
        "ok",
        "/tmp/ok.sql",
        "/* notes about INSERT semantics — see issue #42 */\nSELECT 1\n",
      ),
    ).not.toThrow();
  });

  it("rejects DELETE smuggled after a leading block comment (defence in depth)", () => {
    // A bare `/* SELECT */ DELETE FROM x` would have slipped past a
    // comment-blind first-keyword scan; block-comment stripping makes the
    // deny-list see the real first keyword.
    expect(() =>
      validateRecipeSql(
        "bad",
        "/tmp/bad.sql",
        "/* SELECT */ DELETE FROM files\n",
      ),
    ).toThrow(/read-only/);
  });

  it("rejects pure-block-comment files as empty (no SQL after stripping)", () => {
    expect(() =>
      validateRecipeSql(
        "blank",
        "/tmp/blank.sql",
        "/* placeholder, no SQL yet */\n",
      ),
    ).toThrow(/empty/);
  });
});

describe("extractFrontmatterAndBody — YAML actions parser", () => {
  it("returns body as full text when no frontmatter delimiter present", () => {
    const md = "Just some plain markdown.\n";
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toBeUndefined();
    expect(r.body).toBe(md);
  });

  it("parses a single action with type only", () => {
    const md = `---
actions:
  - type: review-coupling
---
Body line one
Body line two
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toEqual([{ type: "review-coupling" }]);
    expect(r.body.startsWith("Body line one")).toBe(true);
  });

  it("parses action with type + description (double-quoted)", () => {
    const md = `---
actions:
  - type: split-barrel
    description: "Confirm intent before splitting."
---
body
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toEqual([
      { type: "split-barrel", description: "Confirm intent before splitting." },
    ]);
  });

  it("parses action with auto_fixable: true (boolean scalar)", () => {
    const md = `---
actions:
  - type: delete-file
    auto_fixable: true
    description: bare unquoted text is fine
---
body
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toEqual([
      {
        type: "delete-file",
        auto_fixable: true,
        description: "bare unquoted text is fine",
      },
    ]);
  });

  it("parses multiple action items", () => {
    const md = `---
actions:
  - type: a
  - type: b
    description: second
---
body
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toEqual([
      { type: "a" },
      { type: "b", description: "second" },
    ]);
  });

  it("returns undefined actions when no actions key in frontmatter", () => {
    const md = `---
some_other_key: value
---
body
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toBeUndefined();
    expect(r.body.startsWith("body")).toBe(true);
  });

  it("treats malformed frontmatter (no closing ---) as no frontmatter", () => {
    const md = `---
actions:
  - type: foo
this never closes
`;
    const r = extractFrontmatterAndBody(md);
    expect(r.actions).toBeUndefined();
    expect(r.body).toBe(md);
  });
});

describe("readRecipesFromDir — frontmatter integration", () => {
  it("populates actions from sibling .md frontmatter", () => {
    const dir = makeRecipeDir("with-frontmatter");
    writeFileSync(join(dir, "fan-out.sql"), "SELECT 1\n");
    writeFileSync(
      join(dir, "fan-out.md"),
      `---
actions:
  - type: review-coupling
    description: "High fan-out usually means orchestrator role."
---

Top 10 files by dependency fan-out (edge count)
`,
    );
    const r = readRecipesFromDir(dir, "bundled");
    expect(r).toHaveLength(1);
    expect(r[0]!.actions).toEqual([
      {
        type: "review-coupling",
        description: "High fan-out usually means orchestrator role.",
      },
    ]);
    expect(r[0]!.description).toBe(
      "Top 10 files by dependency fan-out (edge count)",
    );
  });
});
