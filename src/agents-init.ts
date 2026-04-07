import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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

/**
 * Optional integrations after canonical `.agents/` is written.
 * - Symlink/copy: `cursor`, `windsurf`, `continue`, `cline`, `amazon-q` (rules → `.agents/rules`; Cursor also maps skills).
 * - Pointer files: `copilot`, `claude-md`, `agents-md`, `gemini-md`.
 */
export type AgentsInitTarget =
  | "cursor"
  | "claude-md"
  | "copilot"
  | "windsurf"
  | "continue"
  | "cline"
  | "amazon-q"
  | "agents-md"
  | "gemini-md";

/** Targets that mirror `.agents/rules` (and Cursor also `.agents/skills`) via symlink or copy. */
export const AGENTS_INIT_SYMLINK_TARGETS: readonly AgentsInitTarget[] = [
  "cursor",
  "windsurf",
  "continue",
  "cline",
  "amazon-q",
] as const;

export function targetsNeedLinkMode(targets: AgentsInitTarget[]): boolean {
  return targets.some((t) => AGENTS_INIT_SYMLINK_TARGETS.includes(t));
}

/** How symlink-style integrations receive `.agents` rules (and Cursor skills). */
export type AgentsInitLinkMode = "symlink" | "copy";

const POINTER_BODY = `This project uses [Codemap](https://github.com/stainless-code/codemap) — a structural SQLite index for AI agents.

- **Skill:** \`.agents/skills/codemap/SKILL.md\`
- **CLI:** \`codemap\` to index, \`codemap query "SELECT …"\` for SQL
- **Rules:** \`.agents/rules/\`

`;

const CLAUDE_MD_TEMPLATE = `# Codemap\n\n${POINTER_BODY}`;

const AGENTS_MD_TEMPLATE = `# Agent instructions (Codemap)

${POINTER_BODY}
Also referenced by **Zed**, **JetBrains AI**-style tools, **Aider**, and other agents that read \`AGENTS.md\` at the repo root.

`;

const GEMINI_MD_TEMPLATE = `# Codemap (Gemini)

${POINTER_BODY}
Use this file if your **Gemini** CLI or IDE loads \`GEMINI.md\` at the repo root.

`;

const COPILOT_TEMPLATE = `# Codemap — GitHub Copilot custom instructions

${POINTER_BODY}
See [GitHub Docs: custom instructions for Copilot](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot).

`;

export interface AgentsInitOptions {
  /** Project root (`.agents/` is created here). */
  projectRoot: string;
  /** Overwrite existing files. */
  force?: boolean;
  /** Extra tool integrations (after `.agents/` is written). */
  targets?: AgentsInitTarget[];
  /**
   * Used when any symlink-style target is selected (\`cursor\`, \`windsurf\`, \`continue\`, \`cline\`, \`amazon-q\`).
   * Default \`symlink\`.
   */
  linkMode?: AgentsInitLinkMode;
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

function removePathForRewrite(
  path: string,
  force: boolean,
  label: string,
): void {
  if (!existsSync(path)) {
    return;
  }
  if (!force) {
    throw new Error(
      `Codemap: ${label} already exists — use --force to replace, or remove it manually.`,
    );
  }
  rmSync(path, { recursive: true, force: true });
}

/**
 * Map `.agents/rules` into a destination directory (symlink or copy).
 */
function wireAgentsRulesTo(
  projectRoot: string,
  destPath: string,
  label: string,
  linkMode: AgentsInitLinkMode,
  force: boolean,
): void {
  const agentsRules = join(projectRoot, ".agents", "rules");
  mkdirSync(dirname(destPath), { recursive: true });
  removePathForRewrite(destPath, force, label);
  if (linkMode === "symlink") {
    const rel = relative(dirname(destPath), agentsRules);
    try {
      symlinkSync(rel, destPath, "dir");
    } catch (err) {
      throw new Error(
        `Codemap: symlink failed for ${label} (${String(err)}). Try copy mode or check permissions on Windows.`,
        { cause: err },
      );
    }
    console.log(`  Linked ${label} → .agents/rules`);
    return;
  }
  cpSync(agentsRules, destPath, { recursive: true });
  console.log(`  Copied .agents/rules → ${label}`);
}

/**
 * Wire Cursor or other tools after `.agents/` exists.
 */
export function applyAgentsInitTargets(
  projectRoot: string,
  targets: AgentsInitTarget[],
  linkMode: AgentsInitLinkMode,
  force: boolean,
): void {
  const agentsRules = join(projectRoot, ".agents", "rules");
  const agentsSkills = join(projectRoot, ".agents", "skills");
  if (!existsSync(agentsRules) || !existsSync(agentsSkills)) {
    throw new Error(
      "Codemap: .agents/rules and .agents/skills must exist before wiring integrations",
    );
  }

  for (const t of targets) {
    switch (t) {
      case "cursor":
        applyCursorIntegration(projectRoot, linkMode, force);
        break;
      case "windsurf":
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".windsurf", "rules"),
          ".windsurf/rules",
          linkMode,
          force,
        );
        break;
      case "continue":
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".continue", "rules"),
          ".continue/rules",
          linkMode,
          force,
        );
        break;
      case "cline":
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".clinerules"),
          ".clinerules",
          linkMode,
          force,
        );
        break;
      case "amazon-q":
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".amazonq", "rules"),
          ".amazonq/rules",
          linkMode,
          force,
        );
        break;
      case "claude-md":
        writePointerFile(
          join(projectRoot, "CLAUDE.md"),
          CLAUDE_MD_TEMPLATE,
          "CLAUDE.md",
          force,
        );
        break;
      case "copilot":
        mkdirSync(join(projectRoot, ".github"), { recursive: true });
        writePointerFile(
          join(projectRoot, ".github", "copilot-instructions.md"),
          COPILOT_TEMPLATE,
          ".github/copilot-instructions.md",
          force,
        );
        break;
      case "agents-md":
        writePointerFile(
          join(projectRoot, "AGENTS.md"),
          AGENTS_MD_TEMPLATE,
          "AGENTS.md",
          force,
        );
        break;
      case "gemini-md":
        writePointerFile(
          join(projectRoot, "GEMINI.md"),
          GEMINI_MD_TEMPLATE,
          "GEMINI.md",
          force,
        );
        break;
    }
  }
}

function writePointerFile(
  path: string,
  content: string,
  label: string,
  force: boolean,
): void {
  if (existsSync(path) && !force) {
    console.warn(
      `  Skipped ${label} (file exists). Use --force to overwrite, or merge manually.`,
    );
    return;
  }
  writeFileSync(path, content, "utf-8");
  console.log(`  Wrote ${label} with Codemap pointers`);
}

function applyCursorIntegration(
  projectRoot: string,
  linkMode: AgentsInitLinkMode,
  force: boolean,
): void {
  const agentsRules = join(projectRoot, ".agents", "rules");
  const agentsSkills = join(projectRoot, ".agents", "skills");
  const cursorRules = join(projectRoot, ".cursor", "rules");
  const cursorSkills = join(projectRoot, ".cursor", "skills");

  mkdirSync(join(projectRoot, ".cursor"), { recursive: true });

  if (linkMode === "symlink") {
    removePathForRewrite(cursorRules, force, ".cursor/rules");
    removePathForRewrite(cursorSkills, force, ".cursor/skills");
    const relRules = relative(dirname(cursorRules), agentsRules);
    const relSkills = relative(dirname(cursorSkills), agentsSkills);
    try {
      symlinkSync(relRules, cursorRules, "dir");
      symlinkSync(relSkills, cursorSkills, "dir");
    } catch (err) {
      throw new Error(
        `Codemap: symlink failed for Cursor integration (${String(err)}). Try re-running with copy mode or check permissions on Windows.`,
        { cause: err },
      );
    }
    console.log(
      "  Linked .cursor/rules → .agents/rules and .cursor/skills → .agents/skills",
    );
    return;
  }

  removePathForRewrite(cursorRules, force, ".cursor/rules");
  removePathForRewrite(cursorSkills, force, ".cursor/skills");
  cpSync(agentsRules, cursorRules, { recursive: true });
  cpSync(agentsSkills, cursorSkills, { recursive: true });
  console.log(
    "  Copied rules and skills into .cursor/rules and .cursor/skills",
  );
}

/**
 * Copy bundled rules and skills into `<projectRoot>/.agents/`, optional integrations, `.gitignore` hint.
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

  const targets = options.targets ?? [];
  const linkMode = options.linkMode ?? "symlink";
  if (targets.length > 0) {
    applyAgentsInitTargets(
      options.projectRoot,
      targets,
      linkMode,
      !!options.force,
    );
  } else {
    console.log(
      "  Tip: run `codemap agents init --interactive` to wire editors (Cursor, Copilot, …) or add CLAUDE.md / AGENTS.md",
    );
  }

  ensureGitignoreCodemapPattern(options.projectRoot);
  return true;
}
