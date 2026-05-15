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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";

export type AgentContentKind = "skill" | "rule";

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
