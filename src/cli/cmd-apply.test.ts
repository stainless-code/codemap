/**
 * End-to-end CLI coverage for `codemap apply <recipe-id>`. Exercises the
 * full pipeline (bootstrap → recipe execution → apply-engine → disk-state
 * assertions). Uses the same per-test temp project + full-index pattern as
 * cmd-query-recency.test.ts.
 *
 * The TTY-prompt path (Q6 (a) interactive) is NOT tested here — Q9 locked
 * "TTY-prompt path tested via --yes flag (skipping prompt); non-TTY-no-yes
 * rejection tested explicitly." Bun.spawn's stdout is non-TTY by default,
 * so subprocess invocations exercise exactly the non-TTY policy.
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
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const indexTs = join(repoRoot, "src", "index.ts");
let bunBin: string | null = null;

interface CliResult {
  exitCode: number;
  out: string;
  err: string;
}

async function runCli(
  args: string[],
  envOverride: Record<string, string> = {},
): Promise<CliResult> {
  if (bunBin === null) {
    throw new Error("cmd-apply.test: bunBin not initialised by beforeAll.");
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
  bunBin = Bun.which("bun");
  if (!bunBin || !existsSync(indexTs)) {
    throw new Error(
      `cmd-apply.test: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
});

beforeEach(async () => {
  // realpath: oxc-resolver returns the canonical (symlink-dereferenced)
  // path for resolved imports. On macOS `tmpdir()` (`/var/folders/...`)
  // and `/tmp` are both symlinks, so without realpath the project root
  // and `imports.resolved_path` disagree on prefix and the import-rename
  // join in `rename-preview.sql` returns 0 rows.
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "codemap-cli-apply-")));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "entry.ts"), tinySource, "utf8");
  writeFileSync(join(projectRoot, "src", "helper.ts"), helperSource, "utf8");
  writeFileSync(join(projectRoot, "package.json"), "{}\n", "utf8");
  const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
  expect(idx.exitCode).toBe(0);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function readFile(rel: string): string {
  return readFileSync(join(projectRoot, rel), "utf8");
}

describe("codemap apply <recipe-id> — CLI integration", () => {
  describe("--dry-run", () => {
    it("emits the dry-run envelope without touching disk", async () => {
      const before = readFile("src/helper.ts");
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--dry-run",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.mode).toBe("dry-run");
      expect(env.applied).toBe(false);
      expect(env.summary.rows_applied).toBe(0);
      expect(env.summary.rows).toBeGreaterThan(0);
      expect(readFile("src/helper.ts")).toBe(before);
    });

    it("rejects --dry-run + --yes as mutually exclusive", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--dry-run",
          "--yes",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain("mutually exclusive");
    });
  });

  describe("--yes (apply path)", () => {
    it("writes the rename to disk and reports applied=true", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.mode).toBe("apply");
      expect(env.applied).toBe(true);
      expect(env.summary.rows_applied).toBeGreaterThan(0);
      expect(readFile("src/helper.ts")).toContain("function worker(");
      expect(readFile("src/helper.ts")).not.toContain("function helper(");
      expect(readFile("src/entry.ts")).toContain("import { worker }");
    });

    it("renaming an already-applied symbol is a no-op after reindex (Q7 (a))", async () => {
      const first = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(first.exitCode).toBe(0);

      // Re-index so the recipe sees post-rename state.
      const reindex = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(reindex.exitCode).toBe(0);

      const second = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(second.exitCode).toBe(0);
      const env = JSON.parse(second.out);
      expect(env.summary.rows).toBe(0);
      expect(env.summary.rows_applied).toBe(0);
    });
  });

  describe("Q6 — non-TTY gate", () => {
    it("rejects non-TTY apply without --yes / --dry-run", async () => {
      const r = await runCli(
        ["apply", "rename-preview", "--params", "old=helper,new=worker"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain("--yes");
    });

    it("emits the rejection as JSON envelope under --json", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      const env = JSON.parse(r.out);
      expect(env.error).toContain("--yes");
    });
  });

  describe("error paths", () => {
    it("emits unknown-recipe error with the catalog hint", async () => {
      const r = await runCli(
        ["apply", "no-such-recipe-id", "--dry-run", "--json"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      const env = JSON.parse(r.out);
      expect(env.error).toContain("unknown recipe");
      expect(env.error).toContain("rename-preview"); // catalog hint includes known ids
    });

    it("requires a positional recipe id", async () => {
      const r = await runCli(["apply", "--dry-run"], {
        CODEMAP_ROOT: projectRoot,
      });
      expect(r.exitCode).toBe(1);
      expect(r.err).toMatch(/recipe-id|--rows|--diff-input/);
    });

    it("rejects unknown options", async () => {
      const r = await runCli(["apply", "rename-preview", "--no-such-flag"], {
        CODEMAP_ROOT: projectRoot,
      });
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain("unknown option");
    });
  });

  describe("--help", () => {
    it("prints usage without bootstrapping", async () => {
      const r = await runCli(["apply", "--help"]);
      expect(r.exitCode).toBe(0);
      expect(r.out).toContain("codemap apply");
      expect(r.out).toContain("--rows");
      expect(r.out).toContain("--dry-run");
      expect(r.out).toContain("--yes");
    });
  });

  describe("--rows", () => {
    it("applies caller-supplied rows from a JSON file", async () => {
      const rowsPath = join(projectRoot, "apply-rows.json");
      writeFileSync(
        rowsPath,
        JSON.stringify([
          {
            file_path: "src/helper.ts",
            line_start: 1,
            before_pattern: "helper",
            after_pattern: "worker",
          },
        ]),
        "utf8",
      );
      const r = await runCli(["apply", "--rows", rowsPath, "--yes", "--json"], {
        CODEMAP_ROOT: projectRoot,
      });
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.mode).toBe("apply");
      expect(env.applied).toBe(true);
      expect(readFile("src/helper.ts")).toContain("function worker(");
    });
  });

  describe("replace-marker-kind", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "notes.md"),
        "# Notes\n\nTODO: fix later\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("writes FIXME on disk when applied with --yes", async () => {
      const r = await runCli(
        [
          "apply",
          "replace-marker-kind",
          "--params",
          "from_kind=TODO,to_kind=FIXME",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.applied).toBe(true);
      expect(readFile("src/notes.md")).toContain("FIXME:");
      expect(readFile("src/notes.md")).not.toMatch(/\bTODO:/);
    });
  });

  describe("stale-imports", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "widget.ts"),
        'import { unusedBinding } from "./helper";\n\nexport const widget = 1;\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("dry-run finds the sole-specifier import line", async () => {
      const r = await runCli(
        ["apply", "stale-imports", "--dry-run", "--json"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.summary.rows).toBe(1);
      expect(readFile("src/widget.ts")).toContain("unusedBinding");
    });

    it("removes the unused import line with --force --yes", async () => {
      const r = await runCli(
        ["apply", "stale-imports", "--force", "--yes", "--json"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.applied).toBe(true);
      const body = readFile("src/widget.ts");
      expect(body).not.toContain("unusedBinding");
      expect(body).toContain("export const widget");
    });
  });

  describe("migrate-import-source", () => {
    beforeEach(async () => {
      mkdirSync(join(projectRoot, "src", "api"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "api", "client.ts"),
        "export function createClient() {}\n",
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "consumer.ts"),
        'import { createClient } from "~/api/client";\n\ncreateClient();\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("dry-run emits rows for matching import sources", async () => {
      const r = await runCli(
        [
          "apply",
          "migrate-import-source",
          "--params",
          "old_source=~/api/client,new_source=~/api/client-v2",
          "--dry-run",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.mode).toBe("dry-run");
      expect(env.summary.rows).toBeGreaterThan(0);
      expect(readFile("src/consumer.ts")).toContain('from "~/api/client"');
    });
  });
});
