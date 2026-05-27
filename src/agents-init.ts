import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { applyAgentsInitMcp } from "./agents-init-mcp";
import { resolveAgentsInitMcpTargets } from "./agents-init-mcp-registry";
import type { AgentsInitTarget } from "./agents-init-targets";
import { resolveAgentsTemplateDir } from "./agents-template-path";
import { installGitHooks, uninstallGitHooks } from "./application/git-hooks";
import { ensureStateGitignore, resolveStateDir } from "./application/state-dir";

export { resolveAgentsTemplateDir } from "./agents-template-path";

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

/**
 * Split a `/`-relative path into segments, rejecting `..` / `.` so callers
 * can't `join(destRoot, ...)` into a path that escapes `destRoot`. Defence
 * in depth — today's callers source `rel` from `listRegularFilesRecursive`
 * (package-controlled, never produces `..`); throwing surfaces future
 * regressions loudly instead of silently writing outside the dest.
 */
export function relPathToAbsSegments(rel: string): string[] {
  const segments = rel.split("/").filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      throw new Error(
        `relPathToAbsSegments: refusing path with "${seg}" segment: ${JSON.stringify(rel)}`,
      );
    }
  }
  return segments;
}

function removeManagedFileIfExists(abs: string, label: string): void {
  if (!existsSync(abs)) {
    return;
  }
  const st = statSync(abs);
  if (st.isDirectory()) {
    throw new Error(
      `Codemap: ${label} is a directory — remove it manually; init only replaces codemap-managed files.`,
    );
  }
  rmSync(abs, { force: true });
}

function removeBundledPathsIfExist(destBase: string, relPaths: string[]): void {
  for (const rel of relPaths) {
    const abs = join(destBase, ...relPathToAbsSegments(rel));
    removeManagedFileIfExists(abs, abs);
  }
}

function isSymlinkTo(destFile: string, srcFile: string): boolean {
  try {
    if (!lstatSync(destFile).isSymbolicLink()) {
      return false;
    }
    return readlinkSync(destFile) === relative(dirname(destFile), srcFile);
  } catch {
    return false;
  }
}

function filesContentEqual(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

/** HTML comment — marks files init wrote or mirrors from bundled templates; `--force` overwrites only when present. */
export const CODMAP_INIT_MANAGED = "<!-- codemap-init:managed -->";

function fileHasCodemapInitMarker(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return readFileSync(path, "utf-8").includes(CODMAP_INIT_MANAGED);
  } catch {
    return false;
  }
}

/** One-time upgrade for copy-mode mirrors written before {@link CODMAP_INIT_MANAGED} shipped. */
function looksLikeLegacyCodemapMirror(content: string): boolean {
  const t = content.trim();
  if (t.length < 80) {
    return false;
  }
  return (
    t.includes("codemap query") &&
    (t.includes("codemap-pointer-version") ||
      t.includes("codemap://rule") ||
      t.includes("stainless-code/codemap"))
  );
}

function mirrorMayForceOverwrite(path: string): boolean {
  if (fileHasCodemapInitMarker(path)) {
    return true;
  }
  try {
    return looksLikeLegacyCodemapMirror(readFileSync(path, "utf-8"));
  } catch {
    return false;
  }
}

function refuseOverwriteNonManagedMirror(path: string): void {
  throw new Error(
    `Codemap: ${path} exists but is not codemap-managed (missing ${CODMAP_INIT_MANAGED}) — remove or edit manually; init will not overwrite.`,
  );
}

/** Bundled template paths under `rules/` and `skills/` (IDE mirrors sync these only). */
export function resolveBundledAgentMirrorPaths(templateRoot?: string): {
  ruleFiles: string[];
  skillFiles: string[];
} {
  const root = templateRoot ?? resolveAgentsTemplateDir();
  return {
    ruleFiles: listRegularFilesRecursive(join(root, "rules")),
    skillFiles: listRegularFilesRecursive(join(root, "skills")),
  };
}

/** Copy listed paths; never deletes paths outside `relPaths`. */
function copyFilesGranular(
  srcRoot: string,
  destRoot: string,
  relPaths: string[],
  force: boolean,
  renameFn?: (rel: string) => string,
): void {
  for (const rel of relPaths) {
    const destRel = renameFn ? renameFn(rel) : rel;
    const from = join(srcRoot, ...relPathToAbsSegments(rel));
    const to = join(destRoot, ...relPathToAbsSegments(destRel));
    if (existsSync(to)) {
      if (!force && filesContentEqual(from, to)) {
        continue;
      }
      if (!force) {
        throw new Error(
          `Codemap: ${to} already exists — use --force to replace codemap-managed mirror files only.`,
        );
      }
      if (!mirrorMayForceOverwrite(to)) {
        refuseOverwriteNonManagedMirror(to);
      }
      removeManagedFileIfExists(to, to);
    }
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

/** Symlink listed paths; never deletes paths outside `relPaths`. */
function symlinkFilesGranular(
  srcRoot: string,
  destRoot: string,
  relPaths: string[],
  labelForErrors: string,
  force: boolean,
  renameFn?: (rel: string) => string,
): void {
  mkdirSync(destRoot, { recursive: true });
  for (const rel of relPaths) {
    const destRel = renameFn ? renameFn(rel) : rel;
    const srcFile = join(srcRoot, ...relPathToAbsSegments(rel));
    const destFile = join(destRoot, ...relPathToAbsSegments(destRel));
    if (existsSync(destFile)) {
      if (!force && isSymlinkTo(destFile, srcFile)) {
        continue;
      }
      if (!force) {
        throw new Error(
          `Codemap: ${destFile} already exists — use --force to replace codemap-managed mirror files only.`,
        );
      }
      if (!mirrorMayForceOverwrite(destFile)) {
        refuseOverwriteNonManagedMirror(destFile);
      }
      removeManagedFileIfExists(destFile, destFile);
    }
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

export type { AgentsInitTarget } from "./agents-init-targets";
export {
  AGENTS_INIT_SYMLINK_TARGETS,
  targetsNeedLinkMode,
} from "./agents-init-targets";

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

function codemapPointerBlockRegex(flags = "m"): RegExp {
  return new RegExp(
    `${escapeRegexChars(CODMAP_POINTER_BEGIN)}\\s*[\\s\\S]*?${escapeRegexChars(CODMAP_POINTER_END)}`,
    flags,
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
 * - **`force`:** refresh the managed section only (never drops non-pointer content).
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

  const content = readFileSync(path, "utf-8");

  if (content.match(codemapPointerBlockRegex())) {
    const stripped = content
      .replace(codemapPointerBlockRegex("gm"), "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    const sep = stripped.length === 0 || stripped.endsWith("\n") ? "" : "\n\n";
    const next =
      stripped.length === 0 ? wrapped : `${stripped}${sep}${wrapped}`;
    if (next === content) {
      console.log(`  Codemap section in ${label} already up to date`);
      return;
    }
    writeFileSync(path, next, "utf-8");
    console.log(
      force
        ? `  Refreshed Codemap section in ${label} (--force)`
        : `  Updated Codemap section in ${label}`,
    );
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
  /** Install or remove opt-in git hooks for background incremental index. */
  gitHooks?: "install" | "uninstall";
  /** Write MCP config for supported integrations (see `docs/agents.md`). */
  mcp?: boolean;
}

/**
 * Reconcile the self-managed `<state-dir>/.gitignore` (per plan §D11 +
 * Tracer 2). Idempotent: writes only on drift; logs only on actual change.
 * Replaces the per-feature root `.gitignore` patching the old version did
 * — root is no longer touched (nested `.gitignore` covers every artifact).
 */
export function ensureGitignoreCodemapPattern(projectRoot: string): void {
  const stateDir = resolveStateDir({ root: projectRoot });
  const result = ensureStateGitignore(stateDir);
  if (result.written) {
    const verb = result.before === undefined ? "Created" : "Updated";
    console.log(`  ${verb} ${stateDir}/.gitignore`);
  }
}

function wireAgentsRulesTo(
  projectRoot: string,
  destPath: string,
  label: string,
  ruleRelPaths: string[],
  linkMode: AgentsInitLinkMode,
  force: boolean,
): void {
  const agentsRules = join(projectRoot, ".agents", "rules");
  mkdirSync(dirname(destPath), { recursive: true });
  if (linkMode === "symlink") {
    symlinkFilesGranular(agentsRules, destPath, ruleRelPaths, label, force);
    console.log(
      `  Linked ${ruleRelPaths.length} bundled rule file(s) under ${label} → .agents/rules`,
    );
    return;
  }
  copyFilesGranular(agentsRules, destPath, ruleRelPaths, force);
  console.log(
    `  Copied ${ruleRelPaths.length} bundled rule file(s) → ${label}`,
  );
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

  const { ruleFiles: bundledRuleFiles, skillFiles: bundledSkillFiles } =
    resolveBundledAgentMirrorPaths();

  for (const t of targets) {
    switch (t) {
      case "cursor": {
        applyCursorIntegration(
          projectRoot,
          bundledRuleFiles,
          bundledSkillFiles,
          linkMode,
          force,
        );
        break;
      }
      case "windsurf": {
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".windsurf", "rules"),
          ".windsurf/rules",
          bundledRuleFiles,
          linkMode,
          force,
        );
        break;
      }
      case "continue": {
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".continue", "rules"),
          ".continue/rules",
          bundledRuleFiles,
          linkMode,
          force,
        );
        break;
      }
      case "cline": {
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".clinerules"),
          ".clinerules",
          bundledRuleFiles,
          linkMode,
          force,
        );
        break;
      }
      case "amazon-q": {
        wireAgentsRulesTo(
          projectRoot,
          join(projectRoot, ".amazonq", "rules"),
          ".amazonq/rules",
          bundledRuleFiles,
          linkMode,
          force,
        );
        break;
      }
      case "claude-md": {
        upsertCodemapPointerFile(
          join(projectRoot, "CLAUDE.md"),
          CLAUDE_MD_TEMPLATE,
          "CLAUDE.md",
          force,
        );
        break;
      }
      case "copilot": {
        mkdirSync(join(projectRoot, ".github"), { recursive: true });
        upsertCodemapPointerFile(
          join(projectRoot, ".github", "copilot-instructions.md"),
          COPILOT_TEMPLATE,
          ".github/copilot-instructions.md",
          force,
        );
        break;
      }
      case "agents-md": {
        upsertCodemapPointerFile(
          join(projectRoot, "AGENTS.md"),
          AGENTS_MD_TEMPLATE,
          "AGENTS.md",
          force,
        );
        break;
      }
      case "gemini-md": {
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
}

/** Cursor requires `.mdc` for frontmatter-based rules; templates ship as `.md`. */
function mdToMdc(rel: string): string {
  return rel.endsWith(".md") ? rel.slice(0, -3) + ".mdc" : rel;
}

function applyCursorIntegration(
  projectRoot: string,
  ruleRelPaths: string[],
  skillRelPaths: string[],
  linkMode: AgentsInitLinkMode,
  force: boolean,
): void {
  const agentsRules = join(projectRoot, ".agents", "rules");
  const agentsSkills = join(projectRoot, ".agents", "skills");
  const cursorRules = join(projectRoot, ".cursor", "rules");
  const cursorSkills = join(projectRoot, ".cursor", "skills");

  mkdirSync(join(projectRoot, ".cursor"), { recursive: true });

  if (linkMode === "symlink") {
    symlinkFilesGranular(
      agentsRules,
      cursorRules,
      ruleRelPaths,
      ".cursor/rules",
      force,
      mdToMdc,
    );
    symlinkFilesGranular(
      agentsSkills,
      cursorSkills,
      skillRelPaths,
      ".cursor/skills",
      force,
    );
    console.log(
      `  Linked ${ruleRelPaths.length} bundled rule file(s) and ${skillRelPaths.length} bundled skill file(s) under .cursor/ → .agents/`,
    );
    return;
  }

  copyFilesGranular(agentsRules, cursorRules, ruleRelPaths, force, mdToMdc);
  copyFilesGranular(agentsSkills, cursorSkills, skillRelPaths, force);
  console.log(
    "  Copied bundled rules and skills into .cursor/rules and .cursor/skills",
  );
}

async function maybeApplyAgentsInitMcp(
  options: AgentsInitOptions,
): Promise<void> {
  if (options.mcp === true) {
    await applyAgentsInitMcp({
      projectRoot: options.projectRoot,
      force: !!options.force,
      targets: resolveAgentsInitMcpTargets(options.targets),
    });
  }
}

/** Side-effect-only path when `.agents/` exists and `--force` is off. */
function applyMaybeAgentsInitTargetsOnExisting(
  options: AgentsInitOptions,
): void {
  const targets = options.targets ?? [];
  if (targets.length === 0) {
    return;
  }
  applyAgentsInitTargets(
    options.projectRoot,
    targets,
    options.linkMode ?? "symlink",
    false,
  );
  ensureGitignoreCodemapPattern(options.projectRoot);
}

/**
 * Copy bundled `rules/` and `skills/` into `<projectRoot>/.agents/`, optional integrations, `.gitignore` hint.
 * **`--force`** deletes only template-backed files, then writes those files again with per-file copies — your other files under **`.agents/`**, **`rules/`**, or **`skills/`** stay.
 * @returns `false` when `.agents/` exists and `--force` was not used (unless only side effects like `--git-hooks` / `--mcp`).
 */
export async function runAgentsInit(
  options: AgentsInitOptions,
): Promise<boolean> {
  if (options.gitHooks === "uninstall") {
    uninstallGitHooks(options.projectRoot);
    console.log("  Removed codemap blocks from git hooks");
    applyMaybeAgentsInitTargetsOnExisting(options);
    await maybeApplyAgentsInitMcp(options);
    return true;
  }

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
      if (options.gitHooks === "install") {
        installGitHooks(options.projectRoot);
        console.log(
          "  Installed git hooks (post-commit, post-merge, post-checkout) for background codemap sync",
        );
        applyMaybeAgentsInitTargetsOnExisting(options);
        await maybeApplyAgentsInitMcp(options);
        return true;
      }
      if (options.mcp === true) {
        applyMaybeAgentsInitTargetsOnExisting(options);
        await maybeApplyAgentsInitMcp(options);
        return true;
      }
      const targets = options.targets ?? [];
      if (targets.length > 0) {
        applyMaybeAgentsInitTargetsOnExisting(options);
        await maybeApplyAgentsInitMcp(options);
        return true;
      }
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

  copyFilesGranular(
    templateRules,
    destRules,
    bundledRuleFiles,
    !!options.force,
  );
  copyFilesGranular(
    templateSkills,
    destSkills,
    bundledSkillFiles,
    !!options.force,
  );

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

  if (options.gitHooks === "install") {
    installGitHooks(options.projectRoot);
    console.log(
      "  Installed git hooks (post-commit, post-merge, post-checkout) for background codemap sync",
    );
  }

  await maybeApplyAgentsInitMcp(options);

  return true;
}
