/**
 * End-to-end agents init on a copy of fixtures/minimal (dummy corpus).
 * Exercises template copy, IDE mirrors, pointers, MCP safety, and side-effect re-runs.
 */

import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  applyAgentsInitMcp,
  CODEMAP_MCP_SERVER_KEY,
} from "../src/agents-init-mcp.ts";
import {
  CODMAP_INIT_MANAGED,
  CODMAP_POINTER_BEGIN,
  runAgentsInit,
} from "../src/agents-init.ts";
import { isCodemapHookInstalled } from "../src/application/git-hooks.ts";

const REPO_ROOT = join(import.meta.dirname, "..");
const FIXTURE = join(REPO_ROOT, "fixtures/minimal");
const CLI = join(REPO_ROOT, "src/index.ts");
const E2E_TMP = join(REPO_ROOT, ".tmp", "agents-init-e2e");

function copyDummyCorpus() {
  mkdirSync(E2E_TMP, { recursive: true });
  const dir = mkdtempSync(join(E2E_TMP, "corpus-"));
  cpSync(FIXTURE, dir, { recursive: true });
  for (const name of ["index.db", "index.db-wal", "index.db-shm"]) {
    const db = join(dir, ".codemap", name);
    if (existsSync(db)) {
      rmSync(db, { force: true });
    }
  }
  return dir;
}

function runCli(root, args) {
  const result = spawnSync("bun", [CLI, "--root", root, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  return {
    exitCode: result.status ?? 1,
    out: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function isSymlinkTo(destFile, srcFile) {
  try {
    if (!lstatSync(destFile).isSymbolicLink()) {
      return false;
    }
    return readlinkSync(destFile) === relative(dirname(destFile), srcFile);
  } catch {
    return false;
  }
}

describe("agents init on fixtures/minimal dummy corpus", () => {
  it("indexes the corpus and runs a golden recipe", () => {
    const dir = copyDummyCorpus();
    try {
      const index = runCli(dir, ["--full"]);
      expect(index.exitCode).toBe(0);
      const query = runCli(dir, [
        "query",
        "--recipe",
        "index-summary",
        "--json",
      ]);
      expect(query.exitCode).toBe(0);
      expect(query.out).toMatch(/files|symbols/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fresh init wires bundled templates, pointers, MCP, and git hooks (copy mode)", async () => {
    const dir = copyDummyCorpus();
    try {
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      expect(
        await runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: [
            "cursor",
            "windsurf",
            "claude-md",
            "copilot",
            "agents-md",
            "gemini-md",
          ],
          linkMode: "copy",
          mcp: true,
          gitHooks: "install",
        }),
      ).toBe(true);

      expect(
        readFileSync(join(dir, ".agents", "rules", "codemap.md"), "utf-8"),
      ).toContain(CODMAP_INIT_MANAGED);
      expect(
        readFileSync(join(dir, ".cursor", "rules", "codemap.mdc"), "utf-8"),
      ).toContain(CODMAP_INIT_MANAGED);
      expect(
        readFileSync(join(dir, ".windsurf", "rules", "codemap.md"), "utf-8"),
      ).toContain("codemap");
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf-8")).toContain(
        CODMAP_POINTER_BEGIN,
      );
      expect(
        readFileSync(join(dir, ".github", "copilot-instructions.md"), "utf-8"),
      ).toContain(CODMAP_POINTER_BEGIN);
      expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain(
        CODMAP_POINTER_BEGIN,
      );
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(
        isCodemapHookInstalled(join(dir, ".git", "hooks", "post-commit")),
      ).toBe(true);

      const mcp = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      );
      expect(mcp.mcpServers?.[CODEMAP_MCP_SERVER_KEY]?.command).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--force refreshes bundled paths only; custom .agents files stay; custom rules are not mirrored", async () => {
    const dir = copyDummyCorpus();
    try {
      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["cursor"],
        linkMode: "copy",
      });
      writeFileSync(
        join(dir, ".agents", "rules", "team-custom.md"),
        "# Team\n",
        "utf-8",
      );
      writeFileSync(join(dir, ".agents", "TEAM-NOTES.md"), "notes", "utf-8");
      writeFileSync(
        join(dir, ".agents", "rules", "codemap.md"),
        `${CODMAP_INIT_MANAGED}\nstale bundled rule`,
        "utf-8",
      );

      expect(
        await runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["cursor"],
          linkMode: "copy",
        }),
      ).toBe(true);

      expect(
        readFileSync(join(dir, ".agents", "rules", "team-custom.md"), "utf-8"),
      ).toBe("# Team\n");
      expect(readFileSync(join(dir, ".agents", "TEAM-NOTES.md"), "utf-8")).toBe(
        "notes",
      );
      expect(
        readFileSync(join(dir, ".agents", "rules", "codemap.md"), "utf-8"),
      ).not.toContain("stale bundled rule");
      expect(existsSync(join(dir, ".cursor", "rules", "team-custom.mdc"))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves user IDE rules; refreshes managed mirrors; refuses non-managed overwrite", async () => {
    const dir = copyDummyCorpus();
    try {
      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["cursor"],
        linkMode: "copy",
      });
      writeFileSync(
        join(dir, ".cursor", "rules", "team-local.mdc"),
        "# Local team rule\n",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".cursor", "rules", "codemap.mdc"),
        `${CODMAP_INIT_MANAGED}\nstale mirror`,
        "utf-8",
      );

      expect(
        await runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["cursor"],
          linkMode: "copy",
        }),
      ).toBe(true);
      expect(
        readFileSync(join(dir, ".cursor", "rules", "team-local.mdc"), "utf-8"),
      ).toBe("# Local team rule\n");
      expect(
        readFileSync(join(dir, ".cursor", "rules", "codemap.mdc"), "utf-8"),
      ).not.toContain("stale mirror");

      writeFileSync(
        join(dir, ".cursor", "rules", "codemap.mdc"),
        "user-owned codemap slot",
        "utf-8",
      );
      await expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["cursor"],
          linkMode: "copy",
        }),
      ).rejects.toThrow(/not codemap-managed/);
      expect(
        readFileSync(join(dir, ".cursor", "rules", "codemap.mdc"), "utf-8"),
      ).toBe("user-owned codemap slot");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("symlink mode links only bundled paths under .cursor", async () => {
    const dir = copyDummyCorpus();
    try {
      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["cursor"],
        linkMode: "symlink",
      });
      writeFileSync(
        join(dir, ".agents", "rules", "extra-team.md"),
        "# Extra\n",
        "utf-8",
      );
      expect(
        await runAgentsInit({
          projectRoot: dir,
          force: false,
          targets: ["cursor"],
          linkMode: "symlink",
        }),
      ).toBe(true);
      const codemapMdc = join(dir, ".cursor", "rules", "codemap.mdc");
      expect(
        isSymlinkTo(codemapMdc, join(dir, ".agents", "rules", "codemap.md")),
      ).toBe(true);
      expect(existsSync(join(dir, ".cursor", "rules", "extra-team.mdc"))).toBe(
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pointer upsert keeps existing AGENTS.md prose on --force", async () => {
    const dir = copyDummyCorpus();
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        "# Fixture team\n\nCustom onboarding.\n",
        "utf-8",
      );
      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["agents-md"],
      });
      const md = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(md).toContain("# Fixture team");
      expect(md).toContain("Custom onboarding.");
      expect(md).toContain(CODMAP_POINTER_BEGIN);

      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["agents-md"],
      });
      const again = readFileSync(join(dir, "AGENTS.md"), "utf-8");
      expect(again).toContain("Custom onboarding.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MCP merge preserves foreign servers; invalid shape rejected even with --force", async () => {
    const dir = copyDummyCorpus();
    try {
      await runAgentsInit({ projectRoot: dir, force: true, mcp: true });
      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        `${JSON.stringify(
          {
            mcpServers: {
              foreign: { command: "node", args: ["other.js"] },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );
      await applyAgentsInitMcp({ projectRoot: dir, targets: ["cursor"] });
      let parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      );
      expect(parsed.mcpServers.foreign).toEqual({
        command: "node",
        args: ["other.js"],
      });
      expect(parsed.mcpServers[CODEMAP_MCP_SERVER_KEY]).toBeDefined();

      writeFileSync(
        join(dir, ".cursor", "mcp.json"),
        `${JSON.stringify({ mcpServers: "bad", editor: "cursor" }, null, 2)}\n`,
        "utf-8",
      );
      await expect(
        applyAgentsInitMcp({
          projectRoot: dir,
          targets: ["cursor"],
          force: true,
        }),
      ).rejects.toThrow(/mcpServers must be a JSON object/);
      parsed = JSON.parse(
        readFileSync(join(dir, ".cursor", "mcp.json"), "utf-8"),
      );
      expect(parsed.editor).toBe("cursor");
      expect(parsed.mcpServers).toBe("bad");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("CLI side-effect re-runs on existing .agents/ without --force", () => {
    const dir = copyDummyCorpus();
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(dir, ".agents", "KEEP.md"), "fixture note", "utf-8");

      const mcpOnly = runCli(dir, ["agents", "init", "--mcp"]);
      expect(mcpOnly.exitCode).toBe(0);
      expect(readFileSync(join(dir, ".agents", "KEEP.md"), "utf-8")).toBe(
        "fixture note",
      );
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);

      const hooksOnly = runCli(dir, ["agents", "init", "--git-hooks"]);
      expect(hooksOnly.exitCode).toBe(0);
      expect(
        isCodemapHookInstalled(join(dir, ".git", "hooks", "post-commit")),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("indexed dummy corpus still queries after agents init", async () => {
    const dir = copyDummyCorpus();
    try {
      const index = runCli(dir, ["--full"]);
      expect(index.exitCode).toBe(0);
      await runAgentsInit({
        projectRoot: dir,
        force: true,
        targets: ["cursor"],
        mcp: true,
      });
      const query = runCli(dir, [
        "query",
        "--recipe",
        "find-symbol-definitions",
        "--params",
        "name=ShopButton",
        "--json",
      ]);
      expect(query.exitCode).toBe(0);
      expect(query.out).toMatch(/ShopButton/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
