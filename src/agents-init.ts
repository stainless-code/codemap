import { cpSync, existsSync, mkdirSync } from "node:fs";
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

export interface AgentsInitOptions {
  /** Project root (`.agents/` is created here). */
  projectRoot: string;
  /** Overwrite existing files. */
  force?: boolean;
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
  console.log(
    `  Symlink into .cursor/ if needed — see https://github.com/stainless-code/codemap/blob/main/.github/CONTRIBUTING.md`,
  );
  return true;
}
