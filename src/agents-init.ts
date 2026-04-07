import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Directory containing `rules/` and `skills/` (next to `dist/` in published packages).
 */
export function resolveAgentsTemplateDir(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "templates",
    "agents",
  );
}

/** Default DB basename `.codemap` plus SQLite sidecars (`.db`, `-wal`, `-shm`, …). */
const GITIGNORE_CODEMAP_PATTERN = ".codemap.*";

export interface AgentsInitOptions {
  /** Project root (`.agents/` is created here). */
  projectRoot: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/**
 * Ensure `.codemap.*` is listed in `.gitignore` when the project uses Git:
 * - If `<projectRoot>/.git` exists and there is no `.gitignore`, create one with `.codemap.*`.
 * - If `.gitignore` exists, append `.codemap.*` once when missing.
 * - If there is no `.git`, do nothing (not a Git working tree).
 */
export function ensureGitignoreCodemapPattern(projectRoot: string): void {
  const gitDir = join(projectRoot, ".git");
  const gitignorePath = join(projectRoot, ".gitignore");
  if (!existsSync(gitDir)) {
    return;
  }
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${GITIGNORE_CODEMAP_PATTERN}\n`, "utf-8");
    console.log(
      `  Created .gitignore with ${GITIGNORE_CODEMAP_PATTERN} (Git repo, no .gitignore yet)`,
    );
    return;
  }
  const content = readFileSync(gitignorePath, "utf-8");
  const lines = content.split(/\r?\n/);
  if (lines.some((line) => line.trim() === GITIGNORE_CODEMAP_PATTERN)) {
    return;
  }
  const needsLeadingNewline = content.length > 0 && !content.endsWith("\n");
  appendFileSync(
    gitignorePath,
    `${needsLeadingNewline ? "\n" : ""}${GITIGNORE_CODEMAP_PATTERN}\n`,
    "utf-8",
  );
  console.log(`  Appended ${GITIGNORE_CODEMAP_PATTERN} to .gitignore`);
}

/**
 * Copy bundled rules and skills into `<projectRoot>/.agents/`.
 * @returns `false` when `.agents/` exists and `--force` was not used.
 */
export function runAgentsInit(options: AgentsInitOptions): boolean {
  const templateRoot = resolveAgentsTemplateDir();
  if (!existsSync(templateRoot)) {
    throw new Error(
      `Codemap: agent templates not found at ${templateRoot} (expected npm package layout: templates/agents next to dist/)`,
    );
  }

  const destRoot = join(options.projectRoot, ".agents");
  if (existsSync(destRoot) && !options.force) {
    console.error(
      `  .agents/ already exists at ${destRoot}. Re-run with --force to overwrite, or remove the directory.`,
    );
    return false;
  }

  mkdirSync(destRoot, { recursive: true });
  cpSync(join(templateRoot, "rules"), join(destRoot, "rules"), {
    recursive: true,
  });
  cpSync(join(templateRoot, "skills"), join(destRoot, "skills"), {
    recursive: true,
  });

  console.log(`  Wrote agent templates to ${destRoot}`);
  ensureGitignoreCodemapPattern(options.projectRoot);
  console.log(
    `  Symlink into .cursor/ if needed — see https://github.com/stainless-code/codemap/blob/main/.github/CONTRIBUTING.md`,
  );
  return true;
}
