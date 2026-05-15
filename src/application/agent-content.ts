/**
 * Server-side source of the "full" skill markdown that `codemap skill`
 * and `codemap://skill` return. Lives at `templates/agent-content/skill/*.md`
 * — separate from `templates/agents/skills/` because the latter is
 * written to consumer disk by `agents init`, while these stay inside
 * the published package and feed the live fetch surface.
 *
 * Section files are concatenated in lexical name order (joined with a
 * blank line), so a numeric prefix (`00-`, `10-`, `20-`) controls
 * section order. Future bullets replace the single `00-full.md` with
 * multiple files, including `*.gen.md` sections generated from the live
 * recipe catalog / schema DDL.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";

/** Root directory containing per-kind subdirs (today: `skill/`). */
export function resolveAgentContentDir(): string {
  // `resolveAgentsTemplateDir()` already handles dev/dist path resolution
  // (single `..` after `dirname(import.meta.url)`); siblinged to it.
  return join(resolveAgentsTemplateDir(), "..", "agent-content");
}

/** Section files for the skill, sorted by filename. */
function listSkillSectionFiles(): string[] {
  const dir = join(resolveAgentContentDir(), "skill");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Assemble the full skill markdown by concatenating every section file
 * in lexical order (joined with a blank line). Cheap enough to call per
 * request — caches live one level up (`resource-handlers.ts`).
 */
export function assembleSkill(): string {
  const sections = listSkillSectionFiles().map((path) =>
    readFileSync(path, "utf8").trimEnd(),
  );
  return sections.join("\n\n") + "\n";
}
