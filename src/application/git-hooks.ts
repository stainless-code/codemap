import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Shell-comment markers — hook files are executable scripts, not Markdown. */
export const CODEMAP_HOOK_BEGIN = "# CODEMAP_HOOK_BEGIN";
export const CODEMAP_HOOK_END = "# CODEMAP_HOOK_END";

export type GitHookName = "post-commit" | "post-merge" | "post-checkout";

export const DEFAULT_GIT_HOOKS: readonly GitHookName[] = [
  "post-commit",
  "post-merge",
  "post-checkout",
] as const;

const HOOK_BODY = "( codemap >/dev/null 2>&1 & )\n";

export function buildHookBlock(): string {
  return `${CODEMAP_HOOK_BEGIN}\n${HOOK_BODY}${CODEMAP_HOOK_END}\n`;
}

export function upsertHookBlock(existing: string): string {
  const block = buildHookBlock();
  const beginIdx = existing.indexOf(CODEMAP_HOOK_BEGIN);
  const endIdx = existing.indexOf(CODEMAP_HOOK_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const tail = existing.slice(endIdx + CODEMAP_HOOK_END.length);
    const prefix = existing.slice(0, beginIdx);
    return `${prefix}${block}${tail.replace(/^\n?/, "")}`;
  }
  if (existing.length === 0) return block;
  const sep = existing.endsWith("\n") ? "" : "\n";
  return `${existing}${sep}${block}`;
}

export function stripHookBlock(content: string): string {
  const beginIdx = content.indexOf(CODEMAP_HOOK_BEGIN);
  const endIdx = content.indexOf(CODEMAP_HOOK_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return content;
  }
  const before = content.slice(0, beginIdx).replace(/\n$/, "");
  const after = content
    .slice(endIdx + CODEMAP_HOOK_END.length)
    .replace(/^\n/, "");
  if (before.length === 0) return after;
  if (after.length === 0) return before.endsWith("\n") ? before : `${before}\n`;
  return `${before}\n${after}`;
}

export function isCodemapHookInstalled(hookPath: string): boolean {
  if (!existsSync(hookPath)) return false;
  return readFileSync(hookPath, "utf8").includes(CODEMAP_HOOK_BEGIN);
}

function resolveGitHooksDir(projectRoot: string): string {
  const gitDir = join(projectRoot, ".git");
  if (!existsSync(gitDir)) {
    throw new Error(
      `codemap: ${projectRoot} is not a git repository — git hooks require .git/`,
    );
  }
  const hooksDir = join(gitDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  return hooksDir;
}

export function installGitHooks(
  projectRoot: string,
  hooks: readonly GitHookName[] = DEFAULT_GIT_HOOKS,
): void {
  const hooksDir = resolveGitHooksDir(projectRoot);
  for (const name of hooks) {
    const hookPath = join(hooksDir, name);
    const prev = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
    const next = upsertHookBlock(prev);
    writeFileSync(hookPath, next, "utf8");
    try {
      chmodSync(hookPath, 0o755);
    } catch {
      // Windows / sandbox may reject chmod; hook content still written.
    }
  }
}

export function uninstallGitHooks(
  projectRoot: string,
  hooks: readonly GitHookName[] = DEFAULT_GIT_HOOKS,
): void {
  const hooksDir = resolveGitHooksDir(projectRoot);
  for (const name of hooks) {
    const hookPath = join(hooksDir, name);
    if (!existsSync(hookPath)) continue;
    const prev = readFileSync(hookPath, "utf8");
    const next = stripHookBlock(prev);
    if (next.trim().length === 0) {
      continue;
    }
    writeFileSync(hookPath, next, "utf8");
  }
}
