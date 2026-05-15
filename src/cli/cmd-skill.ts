import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";
import { assembleSkill } from "../application/agent-content";

/**
 * `codemap skill` / `codemap rule` — print the bundled agent content
 * shipped with this installed codemap version. Pointer files written by
 * `agents init` direct agents here so package upgrades carry today's
 * content without re-running init.
 *
 * Skill text is assembled from `templates/agent-content/skill/*.md` so
 * future bullets can add auto-generated sections (recipes, schema) by
 * dropping new section files alongside the hand-written ones. Rule text
 * still reads the single-file consumer template — bullet 4 generalises.
 */
export type AgentContentKind = "skill" | "rule";

export function printAgentContentCmdHelp(kind: AgentContentKind): void {
  const verb = kind;
  const source =
    kind === "skill"
      ? "templates/agent-content/skill/*.md (assembled)"
      : "templates/agents/rules/codemap.md";
  console.log(`Usage: codemap ${verb}

Prints the full ${kind} markdown bundled with the installed codemap
package (source: ${source}). Pointer files written by
\`codemap agents init\` redirect agents here so upgrading codemap
auto-refreshes the served content — no \`agents init\` re-run needed.

Examples:
  codemap ${verb}
  codemap ${verb} > .agents/${kind === "skill" ? "skills/codemap/SKILL" : "rules/codemap"}.full.md
`);
}

export function runAgentContentCmd(kind: AgentContentKind): void {
  if (kind === "skill") {
    process.stdout.write(assembleSkill());
    return;
  }
  const path = join(resolveAgentsTemplateDir(), "rules", "codemap.md");
  process.stdout.write(readFileSync(path, "utf8"));
}
