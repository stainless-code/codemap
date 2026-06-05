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
import { execSync } from "node:child_process";
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

    it("rejects --params with --rows", async () => {
      const r = await runCli(
        ["apply", "--rows", "-", "--params", "old=a,new=b", "--yes"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      expect(r.err).toContain("--params can only be used with <recipe-id>");
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

  describe("migrate-deprecated", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "legacy.ts"),
        "/**\n * @deprecated Use newHelper instead.\n */\nexport function oldHelper(): void {}\n",
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "use.ts"),
        'import { oldHelper } from "./legacy";\n\nexport function run() {\n  return oldHelper();\n}\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("dry-run emits call-site rows for a deprecated symbol", async () => {
      const r = await runCli(
        [
          "apply",
          "migrate-deprecated",
          "--params",
          "symbol=oldHelper,replacement=newHelper",
          "--dry-run",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.summary.rows).toBeGreaterThan(0);
      expect(readFile("src/use.ts")).toContain("oldHelper");
    });

    it("rewrites call sites with --force --yes", async () => {
      const r = await runCli(
        [
          "apply",
          "migrate-deprecated",
          "--params",
          "symbol=oldHelper,replacement=newHelper",
          "--force",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const body = readFile("src/use.ts");
      expect(body).toContain("import { newHelper }");
      expect(body).toContain("return newHelper()");
      expect(body).not.toMatch(/\boldHelper\b/);
    });
  });

  describe("deprecated-usages", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "legacy.ts"),
        "/**\n * @deprecated Use newHelper instead.\n */\nexport function oldHelper(): void {}\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("rewrites the @deprecated JSDoc line on disk", async () => {
      const r = await runCli(
        [
          "apply",
          "deprecated-usages",
          "--params",
          "symbol=oldHelper,replacement_message=Prefer newHelper.",
          "--force",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const body = readFile("src/legacy.ts");
      expect(body).toContain("@deprecated Prefer newHelper.");
      expect(body).not.toContain("Use newHelper instead");
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

    it("rejects --yes without --force when recipe is not auto_fixable", async () => {
      const r = await runCli(["apply", "stale-imports", "--yes", "--json"], {
        CODEMAP_ROOT: projectRoot,
      });
      expect(r.exitCode).toBe(1);
      expect(r.err + r.out).toMatch(/auto_fixable|--force/);
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

    it("removes one specifier from a multi-specifier import line", async () => {
      writeFileSync(
        join(projectRoot, "src", "helper.ts"),
        `${helperSource}export function usedOne(): number { return 1; }
export function staleOne(): number { return 2; }
`,
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "multi.ts"),
        'import { usedOne, staleOne } from "./helper";\n\nexport const multi = usedOne();\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);

      const r = await runCli(
        [
          "apply",
          "stale-imports",
          "--params",
          "in_file=src/multi",
          "--force",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const body = readFile("src/multi.ts");
      expect(body).toContain('import { usedOne } from "./helper"');
      expect(body).not.toContain("staleOne");
      expect(body).toContain("export const multi");
    });
  });

  describe("rename-preview homonym define_in", () => {
    beforeEach(async () => {
      mkdirSync(join(projectRoot, "src", "bench"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-helper-a.ts"),
        'export function helper(): string {\n  return "a";\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-helper-b.ts"),
        'export function helper(): string {\n  return "b";\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-consumer-a.ts"),
        'import { helper } from "./homonym-helper-a";\n\nexport function useHelperA(): string {\n  return helper();\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-consumer-b.ts"),
        'import { helper } from "./homonym-helper-b";\n\nexport function useHelperB(): string {\n  return helper();\n}\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("applies only the anchored homonym with define_in", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker,define_in=src/bench/homonym-helper-a.ts",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.applied).toBe(true);
      expect(readFile("src/bench/homonym-helper-a.ts")).toContain("worker");
      expect(readFile("src/bench/homonym-consumer-a.ts")).toContain("worker");
      expect(readFile("src/bench/homonym-helper-b.ts")).toMatch(
        /function helper\(\)/,
      );
      const consumerB = readFile("src/bench/homonym-consumer-b.ts");
      expect(consumerB).toContain("helper()");
      expect(consumerB).not.toContain("worker");
    });
  });

  describe("codemap rename alias", () => {
    beforeEach(async () => {
      mkdirSync(join(projectRoot, "src", "bench"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-helper-a.ts"),
        'export function helper(): string {\n  return "a";\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-helper-b.ts"),
        'export function helper(): string {\n  return "b";\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-consumer-a.ts"),
        'import { helper } from "./homonym-helper-a";\n\nexport function useHelperA(): string {\n  return helper();\n}\n',
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "homonym-consumer-b.ts"),
        'import { helper } from "./homonym-helper-b";\n\nexport function useHelperB(): string {\n  return helper();\n}\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("rewrites to apply rename-preview with homonym scope", async () => {
      const r = await runCli(
        [
          "rename",
          "helper",
          "worker",
          "--define-in",
          "src/bench/homonym-helper-a.ts",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.applied).toBe(true);
      expect(readFile("src/bench/homonym-helper-a.ts")).toContain("worker");
      expect(readFile("src/bench/homonym-consumer-a.ts")).toContain("worker");
      expect(readFile("src/bench/homonym-helper-b.ts")).toMatch(
        /function helper\(\)/,
      );
    });
  });

  describe("rename-preview member JSX", () => {
    beforeEach(async () => {
      mkdirSync(join(projectRoot, "src", "bench"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src", "bench", "ui.ts"),
        "export function UiPanel(): string { return 'ok'; }\n",
        "utf8",
      );
      writeFileSync(
        join(projectRoot, "src", "bench", "host.tsx"),
        'import * as UI from "./ui";\n\nexport function Host() {\n  return <UI.UiPanel />;\n}\n',
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("applies jsx_element_rows for a namespaced member tag", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=UiPanel,new=TilePanel,in_file=src/bench/host",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const body = readFile("src/bench/host.tsx");
      expect(body).toContain("<UI.TilePanel />");
      expect(body).not.toContain("UiPanel");
    });
  });

  describe("migrate-jsx-prop", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "Card.tsx"),
        "export function Card() {\n  return <article data-id={1} hidden />;\n}\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("renames a JSX attribute name on disk with --force --yes", async () => {
      const r = await runCli(
        [
          "apply",
          "migrate-jsx-prop",
          "--params",
          "old_name=data-id,new_name=data-testid",
          "--force",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const body = readFile("src/Card.tsx");
      expect(body).toContain("data-testid={1}");
      expect(body).not.toContain("data-id=");
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

  describe("--diff-input", () => {
    it("applies hunks parsed from a unified diff file", async () => {
      const diff = `diff --git a/src/helper.ts b/src/helper.ts
--- a/src/helper.ts
+++ b/src/helper.ts
@@ -1,1 +1,1 @@
-export function helper(): number {
+export function worker(): number {
`;
      const diffPath = join(projectRoot, "rename.patch");
      writeFileSync(diffPath, diff, "utf8");
      const r = await runCli(
        ["apply", "--diff-input", diffPath, "--yes", "--json"],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.applied).toBe(true);
      expect(readFile("src/helper.ts")).toContain("function worker()");
      expect(readFile("src/helper.ts")).not.toContain("function helper()");
    });
  });

  describe("--until-empty", () => {
    beforeEach(async () => {
      writeFileSync(
        join(projectRoot, "src", "marked.ts"),
        "// FIXME: todo item\nexport const MARKED = 1;\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);
    });

    it("terminates with empty after reindex when recipe rows exhaust", async () => {
      const r = await runCli(
        [
          "apply",
          "replace-marker-kind",
          "--params",
          "from_kind=FIXME,to_kind=XXX",
          "--until-empty",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.terminated_by).toBe("empty");
      expect(env.passes).toBeGreaterThanOrEqual(2);
      expect(readFile("src/marked.ts")).toContain("// XXX:");
      expect(readFile("src/marked.ts")).not.toContain("FIXME");
    });
  });

  describe("--commit", () => {
    beforeEach(() => {
      execSync("git init", { cwd: projectRoot, stdio: "ignore" });
      execSync("git config user.email test@codemap.test", {
        cwd: projectRoot,
        stdio: "ignore",
      });
      execSync("git config user.name Codemap Test", {
        cwd: projectRoot,
        stdio: "ignore",
      });
      execSync("git add -A", { cwd: projectRoot, stdio: "ignore" });
      execSync('git commit -m "initial"', {
        cwd: projectRoot,
        stdio: "ignore",
      });
    });

    it("exits non-zero when --until-empty hits max-passes cap", async () => {
      writeFileSync(
        join(projectRoot, "src", "marked-cap.ts"),
        "// FIXME: todo item\nexport const MARKED_CAP = 1;\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);

      const r = await runCli(
        [
          "apply",
          "replace-marker-kind",
          "--params",
          "from_kind=FIXME,to_kind=XXX",
          "--until-empty",
          "--max-passes",
          "1",
          "--yes",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      const env = JSON.parse(r.out);
      expect(env.terminated_by).toBe("cap");
    });

    it("rejects --commit when --until-empty hits max-passes cap", async () => {
      writeFileSync(
        join(projectRoot, "src", "marked.ts"),
        "// FIXME: todo item\nexport const MARKED = 1;\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);

      const r = await runCli(
        [
          "apply",
          "replace-marker-kind",
          "--params",
          "from_kind=FIXME,to_kind=XXX",
          "--until-empty",
          "--max-passes",
          "1",
          "--yes",
          "--commit",
          "codemap: should not commit partial fixpoint",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      const env = JSON.parse(r.out);
      expect(env.error).toContain('terminated_by "empty"');
      expect(env.error).toContain("cap");
      const log = execSync("git log --oneline", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(log.trim().split("\n").length).toBe(1);
    });

    it("creates a git commit after until-empty fixpoint reaches empty", async () => {
      writeFileSync(
        join(projectRoot, "src", "marked.ts"),
        "// FIXME: todo item\nexport const MARKED = 1;\n",
        "utf8",
      );
      const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
      expect(idx.exitCode).toBe(0);

      const r = await runCli(
        [
          "apply",
          "replace-marker-kind",
          "--params",
          "from_kind=FIXME,to_kind=XXX",
          "--until-empty",
          "--yes",
          "--commit",
          "codemap: migrate FIXME markers",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const env = JSON.parse(r.out);
      expect(env.terminated_by).toBe("empty");
      expect(env.applied).toBe(true);
      const log = execSync("git log -1 --format=%s", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(log.trim()).toBe("codemap: migrate FIXME markers");
      expect(readFile("src/marked.ts")).toContain("// XXX:");
    });

    it("creates a git commit for touched files after a clean apply", async () => {
      const r = await runCli(
        [
          "apply",
          "rename-preview",
          "--params",
          "old=helper,new=worker",
          "--yes",
          "--commit",
          "codemap: rename helper to worker",
          "--json",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(0);
      const log = execSync("git log -1 --format=%s", {
        cwd: projectRoot,
        encoding: "utf8",
      });
      expect(log.trim()).toBe("codemap: rename helper to worker");
      expect(readFile("src/helper.ts")).toContain("function worker()");
    });
  });
});
