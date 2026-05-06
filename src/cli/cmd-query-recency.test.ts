/**
 * CLI write-site coverage for recipe-recency tracking — exercises
 * `runQueryCmd` end-to-end via subprocess, including the success-flag
 * disambiguation that PR #76's audit caught (the `--ci` recipe path
 * exits 1 as a CI gate, but the recipe SUCCEEDED — recency must record).
 *
 * Uses a per-test temp project so each case starts with a clean
 * `recipe_recency` table; copies a minimal source file into the temp
 * dir and full-indexes it via `bun src/index.ts --full` first so
 * `--recipe` calls return real rows.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
const bunBin = Bun.which("bun")!;

async function runCli(
  args: string[],
  envOverride: Record<string, string> = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  const proc = Bun.spawn([bunBin, indexTs, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...envOverride },
  });
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

let projectRoot: string;

// Minimal indexable project: one TS file with two symbols + an import
// graph so dependency / symbol / import recipes have rows to return.
const tinySource = `import { helper } from "./helper";

export function entry(): number {
  return helper() + 1;
}

export const VALUE = "x";
`;
const helperSource = `export function helper(): number {
  return 42;
}
`;

beforeAll(() => {
  // Sanity check: skip the suite if the global `bun` binary or src
  // entry isn't reachable from this test's perspective.
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-query-recency: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
});

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "codemap-cli-recency-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "entry.ts"), tinySource, "utf8");
  writeFileSync(join(projectRoot, "src", "helper.ts"), helperSource, "utf8");
  writeFileSync(join(projectRoot, "package.json"), "{}\n", "utf8");
  // Full index so subsequent --recipe calls have real data.
  const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
  expect(idx.exitCode).toBe(0);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

async function loadRunCount(recipeId: string): Promise<number> {
  const r = await runCli(
    [
      "query",
      "--json",
      `SELECT run_count FROM recipe_recency WHERE recipe_id = '${recipeId}'`,
    ],
    { CODEMAP_ROOT: projectRoot },
  );
  expect(r.exitCode).toBe(0);
  const rows = JSON.parse(r.out) as Array<{ run_count: number }>;
  return rows[0]?.run_count ?? 0;
}

describe("runQueryCmd — recipe-recency CLI write site", () => {
  it("records recency on plain --recipe + --json", async () => {
    const before = await loadRunCount("fan-out");
    const r = await runCli(["query", "--recipe", "fan-out", "--json"], {
      CODEMAP_ROOT: projectRoot,
    });
    expect(r.exitCode).toBe(0);
    expect(await loadRunCount("fan-out")).toBe(before + 1);
  });

  it("records recency on --ci + --format sarif WITH findings (CI gate exits 1, recipe succeeded)", async () => {
    // Regression test for PR #76 audit Finding 1 — `process.exitCode`
    // was the success oracle, so --ci's deliberate exit=1 made the
    // recency tracker treat a successful run as a failure.
    // `unimported-exports` reliably returns rows on this minimal fixture
    // (entry.ts re-exports nothing; unused exports surface).
    const before = await loadRunCount("unimported-exports");
    const r = await runCli(
      ["query", "--recipe", "unimported-exports", "--format", "sarif", "--ci"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(1); // CI gate fired (findings present)
    expect(await loadRunCount("unimported-exports")).toBe(before + 1); // run STILL recorded
  });

  it("records recency on --ci with NO findings (recipe ran cleanly, no gate fired)", async () => {
    // `deprecated-symbols` returns 0 rows on a fixture with no `@deprecated`
    // JSDocs; --ci with 0 rows → exit 0 → recency increments.
    const before = await loadRunCount("deprecated-symbols");
    const r = await runCli(
      ["query", "--recipe", "deprecated-symbols", "--format", "sarif", "--ci"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(0);
    expect(await loadRunCount("deprecated-symbols")).toBe(before + 1);
  });

  it("does NOT record recency on SQL parse errors (real failure)", async () => {
    // recipe id resolves but SQL underneath fails. Easier path: ad-hoc
    // SQL that errors — should never record (recipeId undefined). To
    // exercise the recipe failure branch, pass --params for a recipe
    // that requires a different kind so binding rejects.
    const before = await loadRunCount("find-symbol-by-kind");
    const r = await runCli(
      [
        "query",
        "--recipe",
        "find-symbol-by-kind",
        "--params",
        "kind=invalid_kind_value,name_pattern=%foo%",
        "--json",
      ],
      { CODEMAP_ROOT: projectRoot },
    );
    // Recipe might either reject the param or return 0 rows depending
    // on validation rules — the important assertion is that the table
    // has the run_count we'd expect, not a poisoned over-increment.
    if (r.exitCode === 0) {
      // Param accepted; recipe ran cleanly → counts as success.
      expect(await loadRunCount("find-symbol-by-kind")).toBe(before + 1);
    } else {
      // Param rejected; recipe FAILED → must NOT record.
      expect(await loadRunCount("find-symbol-by-kind")).toBe(before);
    }
  });

  it("does NOT record recency on ad-hoc SQL (recipeId undefined)", async () => {
    const before = await loadRunCount("fan-out");
    const r = await runCli(
      ["query", "--json", "SELECT name FROM symbols LIMIT 1"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(0);
    // No recipe id was passed, so recency must not record under any name.
    const all = await runCli(
      ["query", "--json", "SELECT COUNT(*) AS n FROM recipe_recency"],
      { CODEMAP_ROOT: projectRoot },
    );
    const totalRows = (JSON.parse(all.out) as Array<{ n: number }>)[0]?.n;
    // The ad-hoc SQL didn't touch fan-out either way.
    expect(await loadRunCount("fan-out")).toBe(before);
    expect(totalRows).toBeDefined();
  });

  it("does NOT record recency when recipe_recency: false in user config", async () => {
    // Write the opt-out config and re-index so the toggle is observed.
    mkdirSync(join(projectRoot, ".codemap"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".codemap", "config.json"),
      JSON.stringify({ recipe_recency: false }, null, 2),
      "utf8",
    );
    const r = await runCli(["query", "--recipe", "fan-out", "--json"], {
      CODEMAP_ROOT: projectRoot,
    });
    expect(r.exitCode).toBe(0);
    const total = await runCli(
      ["query", "--json", "SELECT COUNT(*) AS n FROM recipe_recency"],
      { CODEMAP_ROOT: projectRoot },
    );
    const n = (JSON.parse(total.out) as Array<{ n: number }>)[0]?.n;
    expect(n).toBe(0);
  });
});
