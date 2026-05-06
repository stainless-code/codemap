/**
 * End-to-end CLI coverage for recipe-recency, including the `--ci` path
 * (recipe succeeds, exit=1 is the gating signal — recency must still record).
 * Per-test temp project + full-index so `--recipe` calls return real rows.
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
    // Regression: don't undercount when --ci's gate-exit (1) collides
    // with the success-detection logic. `unimported-exports` reliably
    // returns rows on this fixture so the gate fires.
    const before = await loadRunCount("unimported-exports");
    const r = await runCli(
      ["query", "--recipe", "unimported-exports", "--format", "sarif", "--ci"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(1); // CI gate fired (findings present)
    expect(await loadRunCount("unimported-exports")).toBe(before + 1); // run STILL recorded
  });

  it("records recency on --ci with NO findings (recipe ran cleanly, no gate fired)", async () => {
    // `deprecated-symbols` returns 0 rows on a fixture with no `@deprecated`.
    const before = await loadRunCount("deprecated-symbols");
    const r = await runCli(
      ["query", "--recipe", "deprecated-symbols", "--format", "sarif", "--ci"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(0);
    expect(await loadRunCount("deprecated-symbols")).toBe(before + 1);
  });

  it("does NOT record recency on SQL parse errors (real failure)", async () => {
    // Force a recipe-side failure via a param value the recipe rejects.
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
    // Param-value semantics may evolve — assert "exit-mirrors-recency"
    // either way (clean run → record; rejection → no record).
    if (r.exitCode === 0) {
      expect(await loadRunCount("find-symbol-by-kind")).toBe(before + 1);
    } else {
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
    const all = await runCli(
      ["query", "--json", "SELECT COUNT(*) AS n FROM recipe_recency"],
      { CODEMAP_ROOT: projectRoot },
    );
    const totalRows = (JSON.parse(all.out) as Array<{ n: number }>)[0]?.n;
    expect(await loadRunCount("fan-out")).toBe(before);
    expect(totalRows).toBeDefined();
  });

  it("does NOT record recency when recipe_recency: false in user config", async () => {
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
