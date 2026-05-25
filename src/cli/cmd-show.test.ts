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

import type { SymbolMatch } from "../application/show-engine";
import { buildShowResult } from "../application/show-engine";
import { parseShowRest } from "./cmd-show";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
let bunBin: string | null = null;

async function runCli(
  args: string[],
  envOverride: Record<string, string> = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  if (bunBin === null) {
    throw new Error("cmd-show.test: bunBin not initialised by beforeAll.");
  }
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

beforeAll(() => {
  bunBin = Bun.which("bun");
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-show.test: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
});

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "codemap-cli-show-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "entry.ts"),
    "export function entryFn(): void {}\n",
    "utf8",
  );
  writeFileSync(join(projectRoot, "package.json"), "{}\n", "utf8");
  const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
  expect(idx.exitCode).toBe(0);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("parseShowRest", () => {
  it("returns help on --help / -h", () => {
    expect(parseShowRest(["show", "--help"]).kind).toBe("help");
    expect(parseShowRest(["show", "-h"]).kind).toBe("help");
  });

  it("errors when no <name> given", () => {
    const r = parseShowRest(["show"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("missing <name>");
  });

  it("errors on extra positional argument (no fuzzy fallback)", () => {
    const r = parseShowRest(["show", "foo", "bar"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unexpected extra");
  });

  it("errors on unknown flag", () => {
    const r = parseShowRest(["show", "foo", "--regex"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--regex");
  });

  it("errors when --kind has no value", () => {
    const r = parseShowRest(["show", "foo", "--kind"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--kind");
  });

  it("errors when --in has no value", () => {
    const r = parseShowRest(["show", "foo", "--in"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--in");
  });

  it("parses bare name", () => {
    const r = parseShowRest(["show", "foo"]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: undefined,
      inPath: undefined,
      query: undefined,
      withFts: false,
      printSql: false,
      json: false,
    });
  });

  it("parses --query field search", () => {
    const r = parseShowRest([
      "show",
      "--query",
      "kind:function name:Auth",
      "--json",
    ]);
    expect(r).toEqual({
      kind: "run",
      name: undefined,
      kindFilter: undefined,
      inPath: undefined,
      query: "kind:function name:Auth",
      withFts: false,
      printSql: false,
      json: true,
    });
  });

  it("errors when name and --query are both passed", () => {
    const r = parseShowRest(["show", "foo", "--query", "name:foo"]);
    expect(r.kind).toBe("error");
  });

  it("errors when --print-sql lacks --query", () => {
    const r = parseShowRest(["show", "foo", "--print-sql"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--print-sql");
  });

  it("errors when --kind used with --query", () => {
    const r = parseShowRest([
      "show",
      "--query",
      "name:foo",
      "--kind",
      "function",
    ]);
    expect(r.kind).toBe("error");
  });

  it("parses name + flags in any order", () => {
    const r = parseShowRest([
      "show",
      "--json",
      "--kind",
      "function",
      "foo",
      "--in",
      "src/cli",
    ]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: "function",
      inPath: "src/cli",
      query: undefined,
      withFts: false,
      printSql: false,
      json: true,
    });
  });

  it("throws if rest[0] is not 'show'", () => {
    expect(() => parseShowRest(["query"])).toThrow();
  });
});

describe("buildShowResult — disambiguation envelope (Q-2)", () => {
  function match(
    file: string,
    name: string,
    kind = "function",
    line = 1,
  ): SymbolMatch {
    return {
      name,
      kind,
      file_path: file,
      line_start: line,
      line_end: line,
      signature: `${kind} ${name}`,
      is_exported: 1,
      parent_name: null,
      visibility: null,
    };
  }

  it("single match → no disambiguation block", () => {
    const r = buildShowResult([match("src/a.ts", "foo")]);
    expect(r.matches).toHaveLength(1);
    expect(r.disambiguation).toBeUndefined();
  });

  it("zero matches → empty matches, no disambiguation", () => {
    const r = buildShowResult([]);
    expect(r).toEqual({ matches: [] });
  });

  it("zero-match query JSON envelope preserves warning", () => {
    const r = buildShowResult([]);
    r.warning =
      "FTS requested (fts5 config or with_fts / --with-fts) but source_fts is empty. Re-index with --with-fts or fts5: true.";
    expect(r).toEqual({
      matches: [],
      warning: r.warning,
    });
  });

  it("multi-match adds disambiguation with n + by_kind + files + hint", () => {
    const r = buildShowResult([
      match("src/a.ts", "foo", "function"),
      match("src/b.ts", "foo", "function"),
      match("src/c.ts", "foo", "const"),
    ]);
    expect(r.matches).toHaveLength(3);
    expect(r.disambiguation).toEqual({
      n: 3,
      by_kind: { function: 2, const: 1 },
      files: ["src/a.ts", "src/b.ts", "src/c.ts"],
      hint: "Multiple matches. Narrow with --kind <kind>, --in <path>, or --query 'kind:… name:… path:…'.",
    });
  });

  it("dedupes files in disambiguation.files", () => {
    const r = buildShowResult([
      match("src/a.ts", "foo", "function", 5),
      match("src/a.ts", "foo", "function", 50),
    ]);
    expect(r.disambiguation?.files).toEqual(["src/a.ts"]);
  });
});

describe("runShowCmd — query zero-match JSON envelope", () => {
  it("returns {matches:[]} with exit 0 for --query --json", async () => {
    const r = await runCli(
      ["show", "--query", "name:DefinitelyNotIndexed", "--json"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ matches: [] });
  });

  it("returns warning when --with-fts and source_fts empty", async () => {
    const r = await runCli(
      ["show", "--query", "secretToken", "--with-fts", "--json"],
      { CODEMAP_ROOT: projectRoot },
    );
    expect(r.exitCode).toBe(0);
    const json = JSON.parse(r.out) as { matches: unknown[]; warning?: string };
    expect(json.matches).toEqual([]);
    expect(json.warning).toContain("source_fts is empty");
    expect(r.err).toContain("source_fts is empty");
  });
});
