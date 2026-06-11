/**
 * End-to-end DML guard for formatted query output (`--format sarif|badge|…`).
 * Asserts `queryRows` / PRAGMA query_only on every non-json/text format path.
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
let bunBin: string | null = null;

async function runCli(
  args: string[],
  envOverride: Record<string, string> = {},
): Promise<{ exitCode: number; out: string; err: string }> {
  if (bunBin === null) {
    throw new Error(
      "cmd-query-formatted: bunBin not initialised by beforeAll.",
    );
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
      `cmd-query-formatted: cannot locate Bun (${bunBin}) or src entry (${indexTs}).`,
    );
  }
});

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "codemap-cli-formatted-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    join(projectRoot, "src", "keep.ts"),
    "export const KEEP = 1;\n",
    "utf8",
  );
  writeFileSync(
    join(projectRoot, "src", "drop.ts"),
    "export const DROP = 2;\n",
    "utf8",
  );
  writeFileSync(join(projectRoot, "package.json"), "{}\n", "utf8");
  const idx = await runCli(["--full"], { CODEMAP_ROOT: projectRoot });
  expect(idx.exitCode).toBe(0);
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

async function fileCount(): Promise<number> {
  const r = await runCli(
    ["query", "--json", "SELECT COUNT(*) AS n FROM files"],
    { CODEMAP_ROOT: projectRoot },
  );
  expect(r.exitCode).toBe(0);
  const rows = JSON.parse(r.out) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

describe("runQueryCmd — formatted output DML guard", () => {
  it.each([
    "sarif",
    "badge",
    "mermaid",
    "annotations",
    "codeclimate",
    "diff",
    "diff-json",
  ] as const)(
    "rejects DELETE via --format %s without mutating the index",
    async (format) => {
      const before = await fileCount();

      const r = await runCli(
        [
          "query",
          "--format",
          format,
          "DELETE FROM files WHERE path = 'src/drop.ts'",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.out)).toMatchObject({ error: expect.any(String) });

      expect(await fileCount()).toBe(before);

      const drop = await runCli(
        [
          "query",
          "--json",
          "SELECT COUNT(*) AS n FROM files WHERE path = 'src/drop.ts'",
        ],
        { CODEMAP_ROOT: projectRoot },
      );
      expect(drop.exitCode).toBe(0);
      expect(JSON.parse(drop.out)).toEqual([{ n: 1 }]);
    },
  );
});
