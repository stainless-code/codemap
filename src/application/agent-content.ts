/**
 * Server-side source of the "full" skill / rule markdown that
 * `codemap skill` / `codemap rule` and `codemap://skill` /
 * `codemap://rule` return. Lives at `templates/agent-content/<kind>/*.md`
 * — separate from `templates/agents/{rules,skills}/` because the latter
 * is written to consumer disk by `agents init`, while these stay inside
 * the published package and feed the live fetch surface.
 *
 * Section files are concatenated in lexical name order (joined with a
 * blank line), so a numeric prefix (`00-`, `10-`, `20-`) controls
 * section order. Future bullets replace the single `00-full.md` files
 * with multiple sections, including `*.gen.md` ones generated from the
 * live recipe catalog / schema DDL.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";

export type AgentContentKind = "skill" | "rule";

/**
 * Bump when the shape of the pointer files in
 * `templates/agents/{rules/codemap,skills/codemap/SKILL}.md` changes
 * (frontmatter schema, fetch instructions, etc.) — not when the
 * full content served by `codemap skill` / `codemap rule` changes.
 * Should fire roughly once a year, not per release.
 */
export const EXPECTED_POINTER_VERSION = 1;

/** Root directory containing per-kind subdirs (`skill/`, `rule/`). */
export function resolveAgentContentDir(): string {
  // `resolveAgentsTemplateDir()` already handles dev/dist path resolution
  // (single `..` after `dirname(import.meta.url)`); siblinged to it.
  return join(resolveAgentsTemplateDir(), "..", "agent-content");
}

/** Section files for `kind`, sorted by filename. */
function listSectionFiles(kind: AgentContentKind): string[] {
  const dir = join(resolveAgentContentDir(), kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Assemble the full markdown for `kind` by concatenating every section
 * file in lexical order (joined with a blank line). Cheap enough to call
 * per request — caches live one level up (`resource-handlers.ts`).
 */
export function assembleAgentContent(kind: AgentContentKind): string {
  const sections = listSectionFiles(kind).map((path) =>
    readFileSync(path, "utf8").trimEnd(),
  );
  return sections.join("\n\n") + "\n";
}

/** Convenience: `assembleAgentContent("skill")`. Kept for callsite locality. */
export function assembleSkill(): string {
  return assembleAgentContent("skill");
}

/** Convenience: `assembleAgentContent("rule")`. Kept for callsite locality. */
export function assembleRule(): string {
  return assembleAgentContent("rule");
}

/**
 * Result of scanning one consumer-disk pointer file (a no-such-file
 * outcome is not represented — the caller's loop simply skips it).
 */
export interface PointerStatus {
  path: string;
  presentVersion: number | null;
  /** True when stamp is missing AND file is fat enough to look like the legacy thick template (pre-pointer protocol). */
  looksLegacy: boolean;
}

// Pre-pointer SKILL.md was 660 lines and rule.md was 248. Anything
// substantially smaller is either the new pointer or a user-managed
// file we shouldn't nag about.
const LEGACY_FAT_LINE_THRESHOLD = 50;
const POINTER_VERSION_RE = /<!--\s*codemap-pointer-version:\s*(\d+)\s*-->/;

function scanPointer(path: string): PointerStatus | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const match = text.match(POINTER_VERSION_RE);
  const presentVersion = match ? Number(match[1]) : null;
  const looksLegacy =
    presentVersion === null &&
    text.split("\n").length > LEGACY_FAT_LINE_THRESHOLD;
  return { path, presentVersion, looksLegacy };
}

/** Inspect every consumer-disk pointer file rooted at `root`. */
export function checkConsumerPointers(root: string): PointerStatus[] {
  const candidates = [
    join(root, ".agents", "skills", "codemap", "SKILL.md"),
    join(root, ".agents", "rules", "codemap.md"),
  ];
  return candidates
    .map(scanPointer)
    .filter((s): s is PointerStatus => s !== undefined);
}

/**
 * Print a one-line stderr nag for each stale pointer found under
 * `root`. Stamp present and < expected → nag. Stamp absent but file
 * looks like the legacy thick template → nag. Stamp absent and short
 * → silent (user-managed override).
 *
 * Caller invokes once per process at startup; verbs that pipe stdout
 * (`codemap skill > file.md`) are unaffected because the warning goes
 * to stderr.
 */
export function maybeWarnStalePointers(root: string): void {
  for (const s of checkConsumerPointers(root)) {
    const stamped = s.presentVersion !== null;
    if (stamped && s.presentVersion! >= EXPECTED_POINTER_VERSION) continue;
    if (!stamped && !s.looksLegacy) continue;
    const got = stamped ? `v${s.presentVersion}` : "no stamp (legacy template)";
    console.error(
      `codemap: ${s.path} pointer protocol ${got} != expected v${EXPECTED_POINTER_VERSION}. Re-run \`codemap agents init --force\` to refresh.`,
    );
  }
}
