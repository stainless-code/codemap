import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { parseAffectedRest } from "./cmd-affected";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
const minimalRoot = join(repoRoot, "fixtures", "minimal");
let bunBin: string | null = null;

async function runCli(
  args: string[],
  opts: {
    env?: Record<string, string>;
    stdin?: string;
  } = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  if (bunBin === null) {
    throw new Error("cmd-affected.test: bunBin not initialised by beforeAll.");
  }
  const proc = Bun.spawn([bunBin, indexTs, ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.stdin === undefined ? "ignore" : "pipe",
    env: { ...process.env, ...opts.env },
  });
  if (opts.stdin !== undefined) {
    const stdin = proc.stdin;
    if (stdin === undefined) {
      throw new Error(
        "cmd-affected.test: expected pipe stdin on spawned process.",
      );
    }
    stdin.write(opts.stdin);
    stdin.end();
  }
  const exitCode = await proc.exited;
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return { exitCode, out, err };
}

beforeAll(() => {
  bunBin = Bun.which("bun");
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-affected.test: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
});

describe("parseAffectedRest", () => {
  it("returns help on --help / -h", () => {
    expect(parseAffectedRest(["affected", "--help"]).kind).toBe("help");
    expect(parseAffectedRest(["affected", "-h"]).kind).toBe("help");
  });

  it("parses defaults with no path source flags", () => {
    expect(parseAffectedRest(["affected"])).toEqual({
      kind: "run",
      stdin: false,
      changedSince: undefined,
      positionalPaths: [],
      testGlob: undefined,
      maxDepth: undefined,
      json: false,
    });
  });

  it("parses --stdin, --json, --changed-since, and --params", () => {
    expect(
      parseAffectedRest([
        "affected",
        "--stdin",
        "--json",
        "--changed-since",
        "origin/main",
        "--params",
        "test_glob=*.test.ts,max_depth=12",
      ]),
    ).toEqual({
      kind: "run",
      stdin: true,
      changedSince: "origin/main",
      positionalPaths: [],
      testGlob: "*.test.ts",
      maxDepth: 12,
      json: true,
    });
  });

  it("parses positional paths", () => {
    expect(
      parseAffectedRest(["affected", "./src/a.ts", "src/b.ts", "--json"]),
    ).toEqual({
      kind: "run",
      stdin: false,
      changedSince: undefined,
      positionalPaths: ["src/a.ts", "src/b.ts"],
      testGlob: undefined,
      maxDepth: undefined,
      json: true,
    });
  });

  it("rejects positional paths combined with --stdin", () => {
    const r = parseAffectedRest(["affected", "--stdin", "src/a.ts"]);
    expect(r.kind).toBe("error");
  });

  it("rejects changed_files in --params", () => {
    const r = parseAffectedRest([
      "affected",
      "--params",
      "changed_files=src/a.ts",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/changed_files/);
  });

  it("rejects --changed-since without ref", () => {
    const r = parseAffectedRest(["affected", "--changed-since"]);
    expect(r.kind).toBe("error");
  });

  it("rejects invalid max_depth in --params", () => {
    const r = parseAffectedRest([
      "affected",
      "--params",
      "max_depth=not-a-number",
    ]);
    expect(r.kind).toBe("error");
  });

  it("rejects non-integer max_depth in --params", () => {
    const r = parseAffectedRest(["affected", "--params", "max_depth=1.5"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toMatch(/integer/);
  });
});

describe("codemap affected — fixtures/minimal e2e", () => {
  beforeAll(async () => {
    const idx = await runCli(["--full"], {
      env: { CODEMAP_ROOT: minimalRoot },
    });
    expect(idx.exitCode).toBe(0);
  }, 120_000);

  it("returns transitive test file for a changed source path", async () => {
    const r = await runCli(
      ["affected", "src/lib/complexity-fixture.ts", "--json"],
      { env: { CODEMAP_ROOT: minimalRoot } },
    );
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.out) as Array<{
      test_path: string;
      impact_depth: number;
      actions?: unknown[];
    }>;
    expect(rows).toEqual([
      {
        test_path: "src/__tests__/smoke.test.ts",
        impact_depth: 1,
        actions: [
          {
            type: "run-affected-tests",
            description:
              "Test file paths only — CI composes the exit policy and runner command.",
          },
        ],
      },
    ]);
  });

  it("reads changed paths from stdin pipeline", async () => {
    const r = await runCli(["affected", "--stdin", "--json"], {
      env: { CODEMAP_ROOT: minimalRoot },
      stdin: "src/lib/complexity-fixture.ts\n",
    });
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.out) as Array<{ test_path: string }>;
    expect(rows.map((row) => row.test_path)).toEqual([
      "src/__tests__/smoke.test.ts",
    ]);
  });

  it("returns empty array when stdin has no paths", async () => {
    const r = await runCli(["affected", "--stdin", "--json"], {
      env: { CODEMAP_ROOT: minimalRoot },
      stdin: "\n\n",
    });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual([]);
  });
});
