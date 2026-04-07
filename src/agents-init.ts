import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
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

/**
 * Every regular file path under `dir` relative to `dir` (POSIX-style `/`).
 * Used for template paths (`--force` removal), template writes, and copy-mode IDE sync.
 */
export function listRegularFilesRecursive(
  dir: string,
  relPrefix = "",
): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    const full = join(dir, name);
    if (ent.isDirectory()) {
      out.push(...listRegularFilesRecursive(full, rel));
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function relPathToAbsSegments(rel: string): string[] {
  return rel.split("/").filter(Boolean);
}

/** Copy only listed relative paths from `srcRoot` into `destRoot` (mkdir parents per file). */
function copyFilesGranular(
  srcRoot: string,
  destRoot: string,
  relPaths: string[],
): void {
  for (const rel of relPaths) {
    const from = join(srcRoot, ...relPathToAbsSegments(rel));
    const to = join(destRoot, ...relPathToAbsSegments(rel));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

/** Symlink each file: `destRoot/<rel>` → relative path to `srcRoot/<rel>` (mkdir parents per file). */
function symlinkFilesGranular(
  srcRoot: string,
  destRoot: string,
  relPaths: string[],
  labelForErrors: string,
): void {
  mkdirSync(destRoot, { recursive: true });
  for (const rel of relPaths) {
    const srcFile = join(srcRoot, ...relPathToAbsSegments(rel));
    const destFile = join(destRoot, ...relPathToAbsSegments(rel));
    mkdirSync(dirname(destFile), { recursive: true });
    const target = relative(dirname(destFile), srcFile);
    try {
      symlinkSync(target, destFile, "file");
    } catch (err) {
      throw new Error(
        `Codemap: symlink failed for ${labelForErrors} (${destFile}): ${String(err)}. Try copy mode or check permissions on Windows.`,
        { cause: err },
      );
    }
  }
}

function removeBundledPathsIfExist(destBase: string, relPaths: string[]): void {
  for (const rel of relPaths) {
    const abs = join(destBase, ...relPathToAbsSegments(rel));
    if (!existsSync(abs)) {
      continue;
    }
    rmSync(abs, { recursive: true, force: true });
  }
}

/** Default DB basename `.codemap` plus SQLite sidecars (`.db`, `-wal`, `-shm`, …). */
const GITIGNORE_CODEMAP_PATTERN = ".codemap.*";

/**
 * Optional integrations after canonical `.agents/` is written.
 * - Symlink/copy: `cursor`, `windsurf`, `continue`, `cline`, `amazon-q` (per-file symlinks or copies from `.agents/rules`; Cursor also `.agents/skills`).
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

/** Targets that mirror `.agents/rules` (and Cursor also `.agents/skills`) via per-file symlink or copy. */
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

/** Per-file symlinks vs full file copies into IDE paths. */
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

/** HTML comments — invisible in most Markdown renderers; used to upsert without duplicating on re-run. */
export const CODMAP_POINTER_BEGIN = "<!-- codemap-pointer:begin -->";
export const CODMAP_POINTER_END = "<!-- codemap-pointer:end -->";

function wrapCodemapPointerBlock(inner: string): string {
  return `${CODMAP_POINTER_BEGIN}\n${inner.trim()}\n${CODMAP_POINTER_END}\n`;
}

function escapeRegexChars(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function codemapPointerBlockRegex(): RegExp {
  return new RegExp(
    `${escapeRegexChars(CODMAP_POINTER_BEGIN)}\\s*[\\s\\S]*?${escapeRegexChars(CODMAP_POINTER_END)}`,
    "m",
  );
}

/** Heuristic: file looks like a prior Codemap pointer file before we added markers (upgrade → single managed block). */
function looksLikeLegacyCodemapPointer(content: string): boolean {
  const t = content.trim();
  if (t.length < 80) {
    return false;
  }
  return (
    t.includes("stainless-code/codemap") &&
    t.includes(".agents/skills/codemap") &&
    t.includes("codemap query")
  );
}

/**
 * Create or merge a Codemap pointer file. Idempotent: managed section is between
 * {@link CODMAP_POINTER_BEGIN} / {@link CODMAP_POINTER_END}; re-runs replace that section only.
 * - **No file:** write managed block.
 * - **Existing + markers:** replace inner section (updates stale template text).
 * - **Existing, no markers, legacy Codemap content:** replace whole file with managed block.
 * - **Existing, other content:** append managed block once.
 * - **`force`:** replace entire file with the latest managed block (same as a fresh write).
 */
export function upsertCodemapPointerFile(
  path: string,
  innerTemplate: string,
  label: string,
  force: boolean,
): void {
  const wrapped = wrapCodemapPointerBlock(innerTemplate);

  if (!existsSync(path)) {
    writeFileSync(path, wrapped, "utf-8");
    console.log(`  Wrote ${label} with Codemap pointers`);
    return;
  }

  if (force) {
    writeFileSync(path, wrapped, "utf-8");
    console.log(`  Replaced ${label} (--force)`);
    return;
  }

  const content = readFileSync(path, "utf-8");
  const re = codemapPointerBlockRegex();

  if (content.match(re)) {
    const next = content.replace(re, wrapped);
    if (next === content) {
      console.log(`  Codemap section in ${label} already up to date`);
      return;
    }
    writeFileSync(path, next, "utf-8");
    console.log(`  Updated Codemap section in ${label}`);
    return;
  }

  if (looksLikeLegacyCodemapPointer(content)) {
    writeFileSync(path, wrapped, "utf-8");
    console.log(`  Migrated ${label} to managed Codemap section`);
    return;
  }

  const sep = content.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, content + sep + wrapped, "utf-8");
  console.log(`  Appended Codemap section to ${label}`);
}

export interface AgentsInitOptions {
  /** Project root (`.agents/` is created here). */
  projectRoot: string;
  /** When `.agents/` exists, replace only files that ship in `templates/agents` (and allow integration overwrites per target). */
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
    const ruleFiles = listRegularFilesRecursive(agentsRules);
    symlinkFilesGranular(agentsRules, destPath, ruleFiles, label);
    console.log(
      `  Linked each file under ${label} → .agents/rules (${ruleFiles.length} files)`,
    );
    return;
  }
  const ruleFiles = listRegularFilesRecursive(agentsRules);
  copyFilesGranular(agentsRules, destPath, ruleFiles);
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
        upsertCodemapPointerFile(
          join(projectRoot, "CLAUDE.md"),
          CLAUDE_MD_TEMPLATE,
          "CLAUDE.md",
          force,
        );
        break;
      case "copilot":
        mkdirSync(join(projectRoot, ".github"), { recursive: true });
        upsertCodemapPointerFile(
          join(projectRoot, ".github", "copilot-instructions.md"),
          COPILOT_TEMPLATE,
          ".github/copilot-instructions.md",
          force,
        );
        break;
      case "agents-md":
        upsertCodemapPointerFile(
          join(projectRoot, "AGENTS.md"),
          AGENTS_MD_TEMPLATE,
          "AGENTS.md",
          force,
        );
        break;
      case "gemini-md":
        upsertCodemapPointerFile(
          join(projectRoot, "GEMINI.md"),
          GEMINI_MD_TEMPLATE,
          "GEMINI.md",
          force,
        );
        break;
    }
  }
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
    const ruleFiles = listRegularFilesRecursive(agentsRules);
    const skillFiles = listRegularFilesRecursive(agentsSkills);
    symlinkFilesGranular(agentsRules, cursorRules, ruleFiles, ".cursor/rules");
    symlinkFilesGranular(
      agentsSkills,
      cursorSkills,
      skillFiles,
      ".cursor/skills",
    );
    console.log(
      `  Linked ${ruleFiles.length} rule file(s) and ${skillFiles.length} skill file(s) under .cursor/ → .agents/`,
    );
    return;
  }

  removePathForRewrite(cursorRules, force, ".cursor/rules");
  removePathForRewrite(cursorSkills, force, ".cursor/skills");
  copyFilesGranular(
    agentsRules,
    cursorRules,
    listRegularFilesRecursive(agentsRules),
  );
  copyFilesGranular(
    agentsSkills,
    cursorSkills,
    listRegularFilesRecursive(agentsSkills),
  );
  console.log(
    "  Copied rules and skills into .cursor/rules and .cursor/skills",
  );
}

/**
 * Copy bundled `rules/` and `skills/` into `<projectRoot>/.agents/`, optional integrations, `.gitignore` hint.
 * **`--force`** deletes only template-backed files, then writes those files again with per-file copies — your other files under **`.agents/`**, **`rules/`**, or **`skills/`** stay.
 * @returns `false` when `.agents/` exists and `--force` was not used.
 */
export function runAgentsInit(options: AgentsInitOptions): boolean {
  const templateRoot = resolveAgentsTemplateDir();
  if (!existsSync(templateRoot)) {
    throw new Error(
      `Codemap: agent templates not found at ${templateRoot} (expected npm package layout: templates/agents next to dist/)`,
    );
  }

  const templateRules = join(templateRoot, "rules");
  const templateSkills = join(templateRoot, "skills");
  const bundledRuleFiles = listRegularFilesRecursive(templateRules);
  const bundledSkillFiles = listRegularFilesRecursive(templateSkills);

  const destRoot = join(options.projectRoot, ".agents");
  const destRules = join(destRoot, "rules");
  const destSkills = join(destRoot, "skills");

  if (existsSync(destRoot)) {
    if (!statSync(destRoot).isDirectory()) {
      throw new Error(
        `Codemap: ${destRoot} exists but is not a directory — remove or rename it, then retry.`,
      );
    }
    if (!options.force) {
      console.error(
        `  .agents/ already exists at ${destRoot}. Re-run with --force to refresh bundled template files under rules/ and skills/, or remove the directory.`,
      );
      return false;
    }
    removeBundledPathsIfExist(destRules, bundledRuleFiles);
    removeBundledPathsIfExist(destSkills, bundledSkillFiles);
  } else {
    mkdirSync(destRoot, { recursive: true });
  }

  copyFilesGranular(templateRules, destRules, bundledRuleFiles);
  copyFilesGranular(templateSkills, destSkills, bundledSkillFiles);

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
